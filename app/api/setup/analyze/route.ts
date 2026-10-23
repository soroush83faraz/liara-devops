// POST /api/setup/analyze
//  - multipart/form-data with a `file` (.zip / .tar.gz): analyse in memory, store the bytes (putSource), return
//    { sourceRef, fileName, size, format, analysis, recommendation?, catalog? }. File contents are never echoed.
//  - application/json { description?, answers?, sourceRef? }: without answers -> { questions }; with answers ->
//    analysis built from the answers only (no guessing); with sourceRef -> re-run on the stored upload (retry).
import { PolicyError, assertRateLimit } from "@/lib/security";
import { api, errorResponse, type ApiContext } from "@/lib/server/liara";
import { fa } from "@/lib/i18n/fa";
import { ArchiveError } from "@/lib/setup/archive";
import { QUESTIONS, DescribeBodySchema, analysisFromAnswers, analyzeArchiveBytes } from "@/lib/setup/analyze";
import { loadCatalog, toCatalogView } from "@/lib/setup/catalog";
import { MAX_ARCHIVE_BYTES } from "@/lib/setup/limits";
import { recommendSetup } from "@/lib/setup/recommend";
import {
  BodyTooLargeError,
  MAX_JSON_BYTES,
  MULTIPART_OVERHEAD,
  checkContentLength,
  classifyContentType,
  readBodyCapped,
  readFormDataCapped,
  sanitizeFileName,
} from "@/lib/setup/request";
import { getSource, putSource } from "@/lib/setup/source-store";
import type { ProjectAnalysis } from "@/lib/setup/types";

const E = fa.setupFlow.errors;
const ARCHIVE_STATUS: Record<string, number> = { too_large: 413, unsupported_format: 415 };

async function withRecommendation(ctx: ApiContext, analysis: ProjectAnalysis) {
  try {
    const catalog = await loadCatalog(ctx.liara);
    const view = toCatalogView(catalog);
    // Networks unreadable: say so (an empty list would read as "you have no networks").
    return { recommendation: recommendSetup(analysis, catalog), catalog: view, ...(view.networksError ? { catalogError: "networks_unavailable" as const } : {}) };
  } catch {
    // The analysis is deterministic and stays useful even when Liara is unreachable.
    return { catalogError: "catalog_unavailable" as const };
  }
}

export const POST = api(async (ctx) => {
  const { request, session } = ctx;
  try {
    assertRateLimit(`setup:analyze:${session.accountId}`, 12, 10 * 60_000);
  } catch (e) {
    if (e instanceof PolicyError && e.code === "rate_limited") {
      return errorResponse(429, "rate_limited", E.rate_limited, { retryAfterSec: Math.ceil((e.retryAfterMs ?? 1000) / 1000) });
    }
    throw e;
  }

  const kind = classifyContentType(request.headers.get("content-type"));
  if (!kind) return errorResponse(415, "unsupported_media_type", E.unsupported_media_type);

  try {
    if (kind === "json") {
      const len = checkContentLength(request.headers.get("content-length"), MAX_JSON_BYTES);
      if (!len.ok) return errorResponse(len.status, len.status === 413 ? "payload_too_large" : "bad_request", E.bad_request);
      let parsed;
      try {
        parsed = DescribeBodySchema.safeParse(JSON.parse(new TextDecoder().decode(await readBodyCapped(request, MAX_JSON_BYTES))));
      } catch (e) {
        if (e instanceof BodyTooLargeError) return errorResponse(413, "payload_too_large", E.payload_too_large);
        return errorResponse(400, "bad_request", E.bad_request);
      }
      if (!parsed.success) return errorResponse(400, "bad_request", E.bad_request);
      const { answers, sourceRef } = parsed.data;
      if (sourceRef) {
        const src = await getSource(session.accountId, sourceRef);
        if (!src) return errorResponse(410, "source_expired", E.source_expired);
        const { format, ...analysis } = await analyzeArchiveBytes(src.bytes);
        return Response.json({ sourceRef, fileName: src.fileName, size: src.size, format, analysis, ...(await withRecommendation(ctx, analysis)) }, { headers: { "Cache-Control": "no-store" } });
      }
      if (!answers) return Response.json({ questions: QUESTIONS }, { headers: { "Cache-Control": "no-store" } });
      const analysis = analysisFromAnswers(answers);
      return Response.json({ analysis, ...(await withRecommendation(ctx, analysis)) }, { headers: { "Cache-Control": "no-store" } });
    }

    const len = checkContentLength(request.headers.get("content-length"), MAX_ARCHIVE_BYTES + MULTIPART_OVERHEAD);
    if (!len.ok) return errorResponse(len.status, len.status === 413 ? "payload_too_large" : "bad_request", len.status === 413 ? E.payload_too_large : E.bad_request);
    const form = await readFormDataCapped(request);
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) return errorResponse(400, "missing_file", E.missing_file);
    if (file.size > MAX_ARCHIVE_BYTES) return errorResponse(413, "payload_too_large", E.payload_too_large);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName = sanitizeFileName(file instanceof File ? file.name : "project");
    const { format, ...analysis } = await analyzeArchiveBytes(bytes);
    const { ref } = await putSource(session.accountId, bytes, fileName);
    return Response.json(
      { sourceRef: ref, fileName, size: bytes.byteLength, format, analysis, ...(await withRecommendation(ctx, analysis)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof BodyTooLargeError) return errorResponse(413, "payload_too_large", E.payload_too_large);
    if (e instanceof ArchiveError) {
      const text = Object.prototype.hasOwnProperty.call(E, e.code) ? E[e.code as keyof typeof E] : E.invalid_archive;
      return errorResponse(ARCHIVE_STATUS[e.code] ?? 422, e.code, text);
    }
    throw e;
  }
});
