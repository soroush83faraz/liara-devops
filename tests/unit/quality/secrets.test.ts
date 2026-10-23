// Guard: no credentials in the repo, and .env files stay out of version control.
import { describe, expect, it } from "vitest";
import { listFiles, read } from "./scan";

const TEXT_EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".mdx", ".yml", ".yaml", ".env", ".example", ".txt", ".css", ".html", ".sh", ".toml"];

interface Pattern {
  name: string;
  re: RegExp;
  /** true: also applied inside tests/ (high-confidence patterns only; tests legitimately contain fake URLs and keys). */
  inTests: boolean;
}

const PATTERNS: Pattern[] = [
  // Liara API keys are JWTs (header.payload.signature), so this covers "Liara-token-like" strings too.
  { name: "JWT / Liara API key", inTests: true, re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "private key block", inTests: true, re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { name: "AWS access key id", inTests: true, re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "provider API key (sk-/ghp_/xox)", inTests: true, re: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{20,})\b/g },
  { name: "credentialed URL", inTests: false, re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'`]+:[^\s:/@"'`]{6,}@(?!localhost|127\.0\.0\.1)[^\s"'`]+/gi },
  { name: "long literal assigned to a secret-like name", inTests: false, re: /\b(?:api[_-]?key|secret|token|password|passwd)\w*["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{32,}["']/gi },
];

/**
 * Test files that deliberately plant well-known SAMPLE secrets (the jwt.io example token, fake PEM headers, fake
 * provider keys) to prove that redaction/leak detection works. Path -> reason.
 */
const PLANTED_TEST_FILES: Record<string, string> = {
  "tests/unit/security/redact.test.ts": "plants sample JWT/PEM/provider keys to test redaction",
  "tests/unit/app-read/pure.test.ts": "plants a sample JWT to test log redaction",
  "tests/unit/scripts/spike.test.ts": "plants a sample JWT to test that the spike script strips it",
};

/** Local, git-ignored env files legitimately hold the developer's real keys; the template `.env.example` is still scanned (and the .gitignore rule that keeps the others out is asserted below). */
const LOCAL_ENV_FILE = /(^|\/)\.env(\.(?!example$)[\w.-]+)?$/;

/** A match is fine when it is visibly planted test data. */
const PLANTED = /SYNTH|SYNTHETIC|E2E-|e2e-|EXAMPLE|example|PLACEHOLDER|placeholder|NOT-A-REAL|DUMMY|dummy|FAKE|fake/;

describe("secret scan", () => {
  it("no credential-looking strings in tracked-style files (planted SYNTH-/E2E- markers are allowed)", () => {
    const files = listFiles(["."], TEXT_EXTS).filter(
      (f) => !f.startsWith("demo-app/node_modules/") && f !== "package-lock.json" && !LOCAL_ENV_FILE.test(f) && !f.startsWith("tests/unit/quality/") && !(f in PLANTED_TEST_FILES),
    );
    expect(files.length).toBeGreaterThan(200);
    const hits: string[] = [];
    for (const f of files) {
      const text = read(f);
      for (const { name, re, inTests } of PATTERNS) {
        if (f.startsWith("tests/") && !inTests) continue;
        for (const m of text.matchAll(re)) {
          const around = text.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + m[0].length + 40);
          if (PLANTED.test(m[0]) || PLANTED.test(around)) continue;
          hits.push(`${f}  [${name}]  ${m[0].slice(0, 12)}…(${m[0].length} chars)`);
        }
      }
    }
    expect(hits, "Remove the secret (rotate it if it was real) or mark deliberate test data with a SYNTH-/E2E- marker. Hits:").toEqual([]);
  });

  it("every planted-secret test file is still needed", () => {
    const stale = Object.keys(PLANTED_TEST_FILES).filter((f) => {
      try {
        return !PATTERNS.some(({ re, inTests }) => inTests && new RegExp(re.source, re.flags).test(read(f)));
      } catch {
        return true;
      }
    });
    expect(stale, "Remove entries that no longer plant a secret-like string:").toEqual([]);
  });

  it(".gitignore ignores .env* except .env.example, and key files", () => {
    const rules = read(".gitignore").split("\n").map((l) => l.trim());
    expect(rules, "ignore every .env file").toContain(".env*");
    expect(rules, "but keep the documented template").toContain("!.env.example");
    expect(rules.some((r) => r === "*.pem" || r === "*.key"), "ignore key files").toBe(true);
    expect(rules.indexOf(".env*")).toBeLessThan(rules.indexOf("!.env.example"));
  });

  it(".env.example documents variables but carries no secret values", () => {
    const lines = read(".env.example").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l));
    expect(lines.length).toBeGreaterThan(5);
    const withValues = lines.filter((l) => {
      const [key, ...rest] = l.split("=");
      const value = rest.join("=").trim();
      return /KEY|TOKEN|SECRET|PASSWORD/.test(key) && value !== "";
    });
    expect(withValues, "secret-like variables in .env.example must be empty:").toEqual([]);
  });

  it("the detectors fire on realistic secrets (so a clean scan means something)", () => {
    const samples = [
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
      "-----BEGIN PRIVATE KEY-----",
      "AKIAABCDEFGHIJKLMNOP",
      "sk-abcdefghijklmnopqrstuvwxyz",
      "postgres://admin:hunter22pass@db.internal.example/app",
      'const apiKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCD"',
    ];
    for (const sample of samples) {
      const fired = PATTERNS.filter(({ re }) => new RegExp(re.source, re.flags).test(sample));
      expect(fired.length, sample).toBeGreaterThan(0);
    }
  });
});
