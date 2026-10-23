// Compact, redacted evidence digest for the model: observation ids, kinds, summaries and params only.
// No raw env values, no excerpts of flagged lines (only their count), everything inside an untrusted block.
import { wrapUntrusted } from "@/lib/security/injection";
import type { Redactor } from "@/lib/security/redact";
import type { EvidenceBundle, Observation } from "@/lib/evidence/types";
import type { RuleCandidate } from "@/lib/evidence/hypotheses-rules";
import { DIGEST_FA } from "./prompts.fa";
import { LLM_BUDGET } from "./provider";

export interface DigestInput {
  question: string;
  history?: string[];
  target: { kind: "app" | "db"; name: string };
  sources: EvidenceBundle["sources"];
  observations: readonly Observation[];
  candidates: readonly RuleCandidate[];
  unknowns: readonly { descriptionFa: string }[];
  redactor: Redactor;
}

const TARGET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const SHORT_TEXT_KINDS = new Set(["log_error", "crash", "build_error", "connection_error", "missing_env", "port_mismatch", "oom"]);

function paramList(o: Observation): string {
  return Object.entries(o.params)
    .filter(([k]) => k !== "sig")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 120) : v}`)
    .join(", ");
}

export function observationLine(o: Observation): string {
  const head = `${o.id} [${o.severity}] ${o.kind} ${o.summary}${o.ts ? ` @${o.ts}` : ""} source=${o.source}`;
  const params = paramList(o);
  // A short excerpt helps the model read error types; it stays inside the untrusted block.
  const excerpt = SHORT_TEXT_KINDS.has(o.kind) && o.text ? ` excerpt="${o.text.slice(0, 160).replace(/\s+/g, " ")}"` : "";
  return `${head}${params ? ` {${params}}` : ""}${excerpt}`;
}

/** Renders the digest; total size is capped at LLM_BUDGET.maxInputChars. */
export function buildDigest(d: DigestInput): string {
  const r = d.redactor;
  const usable = d.observations.filter((o) => !o.flagged);
  const flagged = d.observations.length - usable.length;
  const historical = usable.filter((o) => o.params.historical === 1).length;
  const sourceLine = d.sources.map((s) => `${s.source}=${s.status}${s.error ? `(${s.error})` : ""}`).join(", ");
  const candidateLines = d.candidates.map((c) => `- ${c.cause} level=${c.evidence.level} supports=${c.supports.join(",") || "-"} contradicts=${c.contradicts.join(",") || "-"}`);

  let obsBlock = usable.map(observationLine).join("\n");
  const budget = LLM_BUDGET.maxInputChars - 4_000;
  if (obsBlock.length > budget) obsBlock = `${obsBlock.slice(0, budget)}\n${DIGEST_FA.truncated}`;

  const parts = [
    `${DIGEST_FA.question}\n${r.string(d.question).slice(0, 2_000)}`,
    // Earlier turns can quote log excerpts, so they are treated as data too.
    ...(d.history && d.history.length ? [`${DIGEST_FA.history}\n${wrapUntrusted("history", d.history.map((h) => r.string(h).slice(0, 400)).join("\n"), { maxChars: 2_400 })}`] : []),
    // App/db names are Liara slugs; anything else is user-controlled text and travels as untrusted data.
    `${DIGEST_FA.target} ${d.target.kind} ${TARGET_NAME.test(d.target.name) ? d.target.name : wrapUntrusted("target", d.target.name, { maxChars: 200 })}`,
    `${DIGEST_FA.sources} ${sourceLine}`,
    `${DIGEST_FA.observations}\n${wrapUntrusted("evidence", r.string(obsBlock), { maxChars: budget + 200 })}`,
    ...(flagged ? [DIGEST_FA.flagged.replace("{count}", String(flagged))] : []),
    ...(historical ? [DIGEST_FA.historical.replace("{count}", String(historical))] : []),
    ...(candidateLines.length ? [`${DIGEST_FA.candidates}\n${candidateLines.join("\n")}`] : []),
    ...(d.unknowns.length ? [`${DIGEST_FA.unknowns}\n${d.unknowns.slice(0, 8).map((u) => `- ${u.descriptionFa}`).join("\n")}`] : []),
  ];
  const out = parts.join("\n\n");
  return out.length > LLM_BUDGET.maxInputChars ? out.slice(0, LLM_BUDGET.maxInputChars) : out;
}
