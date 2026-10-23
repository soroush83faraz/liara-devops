// How a before/after snapshot cell is shown. HTTP status codes are Latin digits, LTR-isolated («200», never «۲۰۰»);
// release/app states are Persian words with the raw enum kept only in a code badge («در حال اجرا» + RUNNING).
// Pure (no React), so the rules are unit-tested.
import { rawStatusLabel } from "@/components/ui/status";
import { fa } from "@/lib/i18n/fa";
import { faNumber } from "@/lib/i18n/format";
import { statusCode } from "@/lib/i18n/bidi";
import { stripUnsafeChars } from "./text";

type Raw = string | number | boolean | null | undefined;

export type SnapshotCell =
  | { kind: "empty"; text: string }
  | { kind: "http"; code: string }
  | { kind: "state"; raw: string; label?: string }
  | { kind: "number"; text: string }
  | { kind: "bool"; text: string }
  | { kind: "text"; text: string };

const RELEASE_STATES = fa.copilotUi.verification.releaseStates as Record<string, string>;

/** Persian label for a release/app state, or undefined when we do not know it (callers then show the raw code alone). */
export function stateLabel(raw: string | null | undefined): string | undefined {
  const known = rawStatusLabel(raw);
  if (known) return known;
  const key = (raw ?? "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(RELEASE_STATES, key) ? RELEASE_STATES[key] : undefined;
}

/** HTTP status of a probe: `probeStatus`, `httpStatus`, `http_status`, `statusCode`... holding a number or «2xx». */
const HTTP_KEY = /(^|_)(probe|http)|status_?code$/i;
const HTTP_VALUE = /^[1-5](\d\d|xx)$/i;
const STATE_KEY = /(status|state)$/i;

export function snapshotCell(key: string, value: Raw): SnapshotCell {
  if (value === null || value === undefined) return { kind: "empty", text: fa.common.dash };
  if (typeof value === "boolean") return { kind: "bool", text: value ? fa.common.yes : fa.common.no };
  if (HTTP_KEY.test(key) && HTTP_VALUE.test(String(value))) return { kind: "http", code: statusCode(String(value)) };
  if (typeof value === "number") return { kind: "number", text: faNumber(value) };
  const text = stripUnsafeChars(value);
  if (STATE_KEY.test(key) && !/^\d+$/.test(text) && text.length <= 40) {
    // An unrecognised state is shown raw (never guessed); a recognised one gets its Persian word.
    return { kind: "state", raw: text, label: stateLabel(text) };
  }
  return { kind: "text", text };
}
