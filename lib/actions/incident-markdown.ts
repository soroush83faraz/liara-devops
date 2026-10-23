// Plain-Markdown export of an incident (copy / print). Every model-written or log-derived string goes through
// mdText / mdCodeBlock (redacted + escaped); identifiers go into code spans.
import { checkStatus, type Incident } from "@/lib/contracts/proposal";
import { mdCode, mdCodeBlock, mdText } from "./markdown";
import { MD_LABELS as L } from "./messages";

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [`## ${title}`, "", ...lines, ""];
}

export function renderIncidentMarkdown(incident: Incident): string {
  const f = incident.finding;
  const out: string[] = [];
  out.push(`# ${L.title}: ${mdCode(incident.target.kind)} ${mdCode(incident.target.name)}`, "");
  out.push(`- ${L.startedAt}: ${mdCode(incident.startedAt)}`);
  out.push(`- ${L.resolvedAt}: ${incident.resolvedAt ? mdCode(incident.resolvedAt) : L.open}`);
  if (incident.proposalId) out.push(`- ${L.proposal}: ${mdCode(incident.proposalId)}`);
  if (incident.verification) out.push(`- ${L.verification}: ${L.outcome[incident.verification.outcome]}`);
  out.push("");

  out.push(
    ...section(
      L.observed,
      f.facts.flatMap((o) => [
        `- ${mdCode(o.id)} ${mdCode(o.kind)} ${mdCode(o.source)}${o.ts ? ` ${mdCode(o.ts)}` : ""}${o.flagged ? ` ${mdCode("flagged")}` : ""}`,
        "",
        mdCodeBlock(o.text),
        "",
      ]),
    ),
  );

  out.push(
    ...section(
      L.inferred,
      f.hypotheses.flatMap((h) => [
        `### ${mdCode(h.id)} ${mdText(h.titleFa)} (${L.level[h.level]})`,
        "",
        mdText(h.explanationFa),
        "",
        `${L.evidence}: ${h.supports.length ? h.supports.map(mdCode).join(" ") : L.none}`,
        "",
      ]),
    ),
  );

  out.push(...section(L.ruledOut, f.ruledOut.map((r) => `- ${mdText(r.titleFa)}: ${mdText(r.reasonFa)}`)));
  out.push(
    ...section(
      L.unclear,
      f.unknowns.map((u) => `- ${mdText(u.descriptionFa)}${u.howToGet ? ` (${L.howToGet}: ${mdText(u.howToGet)})` : ""}`),
    ),
  );
  out.push(...section(L.limits, (f.limitsNote ?? []).map((n) => `- ${mdText(n)}`)));

  const v = incident.verification;
  if (v) {
    const snap = (title: string, s: Record<string, string | number | boolean | null> | undefined) =>
      s ? [`**${title}**`, "", ...Object.entries(s).map(([k, val]) => `- ${mdCode(k)}: ${mdText(String(val))}`), ""] : [];
    out.push(
      ...section(L.verification, [
        `**${L.outcome[v.outcome]}**`,
        "",
        ...v.checks.map((c) => `- ${mdCode(c.name)}: ${L.checkStatus[checkStatus(c)]}. ${mdText(c.detail)}`),
        "",
        ...snap(L.before, v.before),
        ...snap(L.after, v.after),
      ]),
    );
  }

  out.push(
    ...section(
      L.timeline,
      incident.timeline.map((t) => `- ${mdCode(t.ts)} ${mdCode(t.kind)}${t.refId ? ` ${mdCode(t.refId)}` : ""}${t.textFa ? `: ${mdText(t.textFa)}` : ""}`),
    ),
  );
  return `${out.join("\n").trimEnd()}\n`;
}
