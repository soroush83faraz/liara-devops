import { createRelease, createSourceArchive, getApp, uploadSource } from "@/lib/liara";
import { BodyTooLargeError, readCappedFormData } from "@/lib/create/body-cap";
import { mapDeployError, type DeployFailure } from "@/lib/create/deploy-errors";
import { checkDeployHeaders, sniffArchive, validateDeployFields, type DeployInput } from "@/lib/create/deploy-request";
import { DEPLOY_RATE_LIMIT, MAX_DEPLOY_BODY_BYTES, MAX_JSON_BODY_BYTES, MAX_UPLOAD_BYTES } from "@/lib/create/limits";
import { readJsonCapped } from "@/lib/server/body";
import { errorKeyFor } from "@/lib/create/errors";
import { scanTarGz } from "@/lib/create/tar-scan";
import { createFlow } from "@/lib/i18n/ns/createFlow";
import { appendAudit, assertRateLimit, assertTypedName, getDefaultStore, hashParams, PolicyError } from "@/lib/security";
import { api, errorResponse, toErrorResponse } from "@/lib/server/liara";
import { appNameFrom } from "@/lib/service/app-read/route-helpers";

type Ctx = { params: Promise<{ name: string }> };

const failure = (f: DeployFailure) =>
  errorResponse(f.status, f.code, createFlow.errors[errorKeyFor(f, "deploy")], f.retryAfterSec ? { retryAfterSec: f.retryAfterSec } : undefined);

/** Tier-2 deploy. The typed app name travels in `X-Typed-Name` so it is checked BEFORE any body is read. */
export const POST = api(async ({ liara, session, request }, { params }: Ctx) => {
  const n = await appNameFrom(params);
  if ("error" in n) return n.error;
  const { name } = n;
  const store = getDefaultStore();
  let paramsHash = "0".repeat(64);
  const audit = async (result: "ok" | "error" | "denied", detail?: string) => {
    try {
      await appendAudit(store, session.accountId, { actor: "user", action: "deploy.release", target: { kind: "app", name }, paramsHash, result, detail });
    } catch {
      /* best-effort audit; never masks the outcome */
    }
  };
  const deny = async (f: DeployFailure) => {
    await audit("denied", f.code);
    return failure(f);
  };

  try {
    // 1. rate limit  2. typed name  3. headers / declared size  (all before a single body byte is read)
    try {
      assertRateLimit(`deploy:${session.accountId}`, DEPLOY_RATE_LIMIT.limit, DEPLOY_RATE_LIMIT.windowMs);
      assertTypedName(request.headers.get("x-typed-name"), name);
    } catch (e) {
      if (!(e instanceof PolicyError)) throw e;
      if (e.code === "rate_limited") {
        await audit("denied", e.code);
        return errorResponse(429, "rate_limited", createFlow.errors.rateLimited, {
          retryAfterSec: e.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : undefined,
        });
      }
      return await deny({ status: 400, code: "typed_name_mismatch" });
    }
    const head = checkDeployHeaders({ contentType: request.headers.get("content-type"), contentLength: request.headers.get("content-length") });
    if (!head.ok) return await deny(head);

    // 4. bounded body read + field validation
    let raw: Record<string, unknown> = {};
    let file: File | undefined;
    try {
      if (head.mode === "multipart") {
        const form = await readCappedFormData(request.body, request.headers.get("content-type")!, MAX_DEPLOY_BODY_BYTES);
        raw = { source: form.get("source"), image: form.get("image"), port: form.get("port"), type: form.get("type") };
        const f = form.get("file");
        if (f instanceof File) file = f;
      } else {
        // Bounded even when Content-Length lies or the transfer is chunked.
        const body = await readJsonCapped(request, MAX_JSON_BODY_BYTES);
        if (!body.ok) return await deny(body.reason === "too_large" ? { status: 413, code: "archive_too_large" } : { status: 400, code: "bad_fields" });
        if (typeof body.value === "object" && body.value !== null) raw = body.value as Record<string, unknown>;
      }
    } catch (e) {
      if (e instanceof BodyTooLargeError) return await deny({ status: 413, code: "archive_too_large" });
      return await deny({ status: 400, code: "bad_fields" });
    }
    const checked = validateDeployFields(raw, file ? { name: file.name, size: file.size } : undefined);
    if (!checked.ok) return await deny(checked);
    const input: DeployInput = checked.value;
    paramsHash = hashParams(
      input.source === "archive"
        ? { source: "archive", kind: input.archive, size: input.size, port: input.port, type: input.type }
        : { source: "image", image: input.image, port: input.port },
    );

    // 5. archive safety. A zip is repacked by createSourceArchive (streaming, bounded: total/per-file uncompressed
    //    budget, ratio guard, entry cap; rejects traversal / symlinks / Zip64 / overlapping entries); a tar.gz is
    //    forwarded unchanged after the strict scanTarGz walk with the same bounds.
    let releaseId: string;
    if (input.source === "archive") {
      if (!file || file.size > MAX_UPLOAD_BYTES) return await deny({ status: 413, code: "archive_too_large" });
      const bytes = new Uint8Array(await file.arrayBuffer());
      file = undefined; // the multipart copy is no longer needed: let it be collected before inflating
      if (sniffArchive(bytes) !== input.archive) return await deny({ status: 400, code: "archive_type_mismatch" });
      const upload = input.archive === "zip" ? (await createSourceArchive({ zip: bytes })).data : (await scanTarGz(bytes), bytes);
      // 6. the app must exist and be running, then upload + create the release
      const app = await getApp(liara, name);
      if (app.scale === 0) return await deny({ status: 409, code: "app_stopped" });
      const sourceID = await uploadSource(liara, name, upload, { signal: request.signal });
      releaseId = await createRelease(liara, name, { sourceID, port: input.port, type: input.type });
    } else {
      const app = await getApp(liara, name);
      if (app.scale === 0) return await deny({ status: 409, code: "app_stopped" });
      releaseId = await createRelease(liara, name, { image: input.image, port: input.port, type: "docker" });
    }
    await audit("ok", input.source);
    return Response.json({ releaseId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const mapped = mapDeployError(e);
    await audit("error", mapped?.code ?? (e instanceof Error ? e.name : "error"));
    return mapped ? failure(mapped) : toErrorResponse(e);
  }
});
