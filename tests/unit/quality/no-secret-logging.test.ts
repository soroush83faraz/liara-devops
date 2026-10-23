// Guard: nothing secret-looking is ever passed to console.* in app/, lib/ or components/.
import { describe, expect, it } from "vitest";
import { lineOf, listFiles, read, stripComments } from "./scan";

const CONSOLE_CALL = /\bconsole\s*\.\s*(log|info|debug|warn|error|trace|dir)\s*\(/g;
/** Identifier names that suggest a secret. `value` is included because env values/passwords travel under that name. */
const SECRETISH = /(token(?!s\b)|secret|passw|apikey|api_key|credential|cookie|authorization|bearer)|\bvalues?\b|[a-z]Values?\b|\bsession\b|\brequest\b|\bbody\b|\bheaders?\b/i;

/** Text of the call's argument list with string-literal CONTENT removed (template `${expr}` parts are kept). */
export function argumentExpressions(code: string, openParen: number): string {
  let depth = 0;
  let i = openParen;
  let out = "";
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < code.length && code[i] !== q) i += code[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\") {
          i += 2;
        } else if (code[i] === "$" && code[i + 1] === "{") {
          let d = 1;
          i += 2;
          while (i < code.length && d > 0) {
            if (code[i] === "{") d++;
            else if (code[i] === "}") d--;
            if (d > 0) out += code[i];
            i++;
          }
          out += " ";
        } else i++;
      }
      i++;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) break;
    }
    out += c;
    i++;
  }
  return out;
}

/** A label naming a secret at the END of a literal: "token", "password:", "api key =", "Bearer". */
const LABEL_END = /(?:token|secret|passw(?:or)?d?|pwd|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|credential|cookie|authorization|bearer|توکن|رمز(?: عبور)?)s?\s*[:=]?\s*$/i;
const PURE_LITERAL = /^\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$]*`|-?\d+(?:\.\d+)?|true|false|null|undefined)\s*$/;

/** Top-level arguments of the call starting at `openParen`, as raw source text. */
export function topLevelArguments(code: string, openParen: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = openParen; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) {
        if (code[j] === "\\") j++;
        else if (c === "`" && code[j] === "$" && code[j + 1] === "{") {
          let d = 1;
          j += 2;
          while (j < code.length && d > 0) {
            if (code[j] === "{") d++;
            else if (code[j] === "}") d--;
            if (d > 0) j++;
          }
        }
        j++;
      }
      if (depth >= 1) current += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      if (depth === 1) continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        if (current.trim()) args.push(current.trim());
        break;
      }
    }
    if (c === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    if (depth >= 1) current += c;
  }
  return args;
}

/**
 * `console.log("token", t)` / `console.log("password:", user.pw)` / console.log(`token=${t}`): a literal that ends
 * with a secret label, followed by a value expression. Identifier names alone cannot catch these.
 */
export function logsLabelledSecret(code: string, openParen: number): boolean {
  const args = topLevelArguments(code, openParen);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const quoted = /^(["'])((?:[^\\]|\\.)*)\1$/s.exec(a);
    if (quoted && LABEL_END.test(quoted[2]) && args.slice(i + 1).some((b) => !PURE_LITERAL.test(b))) return true;
    if (a.startsWith("`")) {
      for (const m of a.matchAll(/((?:[^`$\\]|\\.|\$(?!\{))*)\$\{/g)) if (LABEL_END.test(m[1])) return true;
    }
  }
  return false;
}

describe("no secret logging", () => {
  it("the label detector flags a secret label followed by a value, and nothing else", () => {
    const flagged = (src: string) => logsLabelledSecret(src, src.indexOf("("));
    expect(flagged('console.log("token", t)')).toBe(true);
    expect(flagged("console.log('password:', user.pw)")).toBe(true);
    expect(flagged('console.debug("[auth] api key =", cfg.k, 1)')).toBe(true);
    expect(flagged("console.log(`token=${t}`)")).toBe(true);
    expect(flagged("console.info(`got bearer ${h}`)")).toBe(true);
    expect(flagged('console.log("رمز عبور:", p)')).toBe(true);
    expect(flagged('console.error("[api] unexpected error", error instanceof Error ? error.name : typeof error)')).toBe(false);
    expect(flagged('console.warn("token refresh failed", code)')).toBe(false);
    expect(flagged('console.log("token", "not-a-variable", 3)')).toBe(false);
    expect(flagged("console.warn('[session] APP_SESSION_KEY is missing; token not logged')")).toBe(false);
    expect(flagged("console.log(`rows=${n}`)")).toBe(false);
  });

  it("no console.* call logs a value right after a secret label", () => {
    const hits: string[] = [];
    for (const file of listFiles(["app", "lib", "components"], [".ts", ".tsx"])) {
      const code = stripComments(read(file));
      for (const m of code.matchAll(CONSOLE_CALL)) {
        const open = (m.index ?? 0) + m[0].length - 1;
        if (logsLabelledSecret(code, open)) hits.push(`${file}:${lineOf(code, m.index ?? 0)}  console.${m[1]}(…)`);
      }
    }
    expect(hits, "Do not log a value after a token/secret/password label. Offending calls:").toEqual([]);
  });

  it("the detector flags identifiers that carry secrets and ignores plain messages", () => {
    const flagged = (src: string) => SECRETISH.test(argumentExpressions(src, src.indexOf("(")));
    expect(flagged("console.log(token)")).toBe(true);
    expect(flagged("console.error('x', session.token)")).toBe(true);
    expect(flagged("console.log(`got ${env.value}`)")).toBe(true);
    expect(flagged("console.log(rootPassword)")).toBe(true);
    expect(flagged("console.info('llm', { input: usage.inputTokens, output: usage.outputTokens })")).toBe(false); // LLM usage counts
    expect(flagged("console.warn('[session] APP_SESSION_KEY is missing; token not logged')")).toBe(false);
    expect(flagged("console.error('[api] unexpected error', error instanceof Error ? error.name : typeof error)")).toBe(false);
  });

  it("no console.* call receives a token/secret/password/value/session/request/headers expression", () => {
    const hits: string[] = [];
    for (const file of listFiles(["app", "lib", "components"], [".ts", ".tsx"])) {
      const code = stripComments(read(file));
      for (const m of code.matchAll(CONSOLE_CALL)) {
        const open = (m.index ?? 0) + m[0].length - 1;
        const args = argumentExpressions(code, open);
        if (SECRETISH.test(args)) hits.push(`${file}:${lineOf(code, m.index ?? 0)}  console.${m[1]}(${args.replace(/\s+/g, " ").trim().slice(0, 60)})`);
      }
    }
    expect(hits, "Log a stable code or the error NAME, never the value. Offending calls:").toEqual([]);
  });
});
