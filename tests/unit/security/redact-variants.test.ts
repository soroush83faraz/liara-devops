// S3 regression: known secrets were matched only raw / JSON-escaped / URL-encoded, several secret syntaxes were
// missed, and the BROWSER log views were masked without the app's own env values. Matrix from the verifier's
// redact.poc.ts; SYNTHETIC values only.
import { describe, expect, it, vi } from "vitest";
import { createRedactor, redactDeep, redactLines, redactString, REDACTED } from "@/lib/security/redact";
import { B64URL_ALPHABET, prng, randomString } from "../contracts/samples";
import { agentLiara, loadScenario } from "../agent/helpers";

const S = "Zq7pLm2xWv9R"; // a known env value
const ks = { knownSecrets: [S, "hunter22"] };
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

describe("known secrets in transformed forms", () => {
  const FORMS: Array<[string, string, string]> = [
    ["base64 bare", `got ${b64(S)} from cfg`, b64(S)],
    ["base64 without padding", `got ${b64(S).replace(/=+$/, "")}.`, b64(S).replace(/=+$/, "")],
    ["base64url", `v=${b64url(S)}`, b64url(S)],
    ["hex lower", `val ${Buffer.from(S).toString("hex")}`, Buffer.from(S).toString("hex")],
    ["hex upper", `val ${Buffer.from(S).toString("hex").toUpperCase()}`, Buffer.from(S).toString("hex").toUpperCase()],
    ["upper-cased", `val ${S.toUpperCase()}`, S.toUpperCase()],
    ["lower-cased", `val ${S.toLowerCase()}`, S.toLowerCase()],
  ];
  for (const [name, text, needle] of FORMS) {
    it(name, () => {
      const out = redactString(text, ks);
      expect(out, out).not.toContain(needle);
      expect(out).toContain(REDACTED);
    });
  }

  it("finds the secret inside a larger base64 blob at every byte alignment (std and url-safe)", () => {
    for (const pre of ["", "x", "xy", "xyz", "{\"k\":\""]) {
      const blob = Buffer.from(`${pre}${S}","more":"padding text after"}`);
      for (const enc of [blob.toString("base64"), blob.toString("base64url")]) {
        const out = redactString(`payload=${enc}`, ks);
        const decodedSurvivor = Buffer.from(out.replace(/^payload=/, "").split(REDACTED).join(""), "base64").toString("latin1");
        expect(out, `${pre} ${enc}`).toContain(REDACTED);
        expect(decodedSurvivor.includes(S), `${pre} ${enc} -> ${out}`).toBe(false);
      }
    }
  });

  it("secrets with separators are also found with the separators removed", () => {
    const sep = "4111-1111-2222-3333";
    expect(redactString("card 4111111122223333 ok", { knownSecrets: [sep] })).not.toContain("4111111122223333");
  });

  it("a secret split across two adjacent lines (wrapped or printed in halves)", () => {
    expect(redactString(`part1 ${S.slice(0, 6)}\npart2 ${S.slice(6)}`, ks)).not.toMatch(/Zq7pLm|2xWv9R/);
    const wrapped = `key material:\n  ${b64(`${S}${S}`).slice(0, 10)}\n${b64(`${S}${S}`).slice(10)}`;
    expect(redactString(wrapped, ks)).not.toContain(b64(`${S}${S}`).slice(10));
    const r = createRedactor(ks);
    const out = r.lines([`half1 ${S.slice(0, 5)}`, `half2 ${S.slice(5)} end`, "unrelated line"]);
    expect(out.join("\n")).not.toMatch(/Zq7pL|m2xWv9R/);
    expect(out[2]).toBe("unrelated line");
    expect(redactLines([`a ${S.slice(0, 4)}`, `${S.slice(4)} b`], ks).join("\n")).not.toContain(S.slice(4));
  });

  it("unrelated text that merely shares a short prefix is left alone", () => {
    const r = createRedactor(ks);
    expect(r.lines(["build Zq7", "step 2 done"])).toEqual(["build Zq7", "step 2 done"]);
    expect(redactString("Listening on port 3000", ks)).toBe("Listening on port 3000");
  });
});

describe("secret syntaxes the patterns missed", () => {
  const CASES: Array<[string, string, string]> = [
    ["sql password literal", "ALTER USER app WITH PASSWORD 'plainword';", "plainword"],
    ["sql identified by", "CREATE USER x IDENTIFIED BY \"plainword2\"", "plainword2"],
    ["tab separated", "PASSWORD\tplainword", "plainword"],
    ["yaml block scalar", "password: |\n  s3cr3tvalue\n  second-line\nnext: 1", "s3cr3tvalue"],
    ["yaml folded scalar", "api_token: >-\n    folded-secret-text\n", "folded-secret-text"],
    ["yaml value on next line", "db_password:\n  nextlinevalue\n", "nextlinevalue"],
    ["user:pass@host without scheme", "connecting root:plainpass@db.internal:5432", "plainpass"],
    ["german passwort", "passwort=geheim", "geheim"],
    ["kennwort", "Kennwort: geheimnis", "geheimnis"],
    ["persian key", "رمز عبور: geheimwort", "geheimwort"],
    ["persian digits pin", "pin=۱۲۳۴۵۶", "۱۲۳۴۵۶"],
    ["otp", "otp: 918273", "918273"],
    ["mysql -p separate", "mysql -u root -p hunter2x -h db", "hunter2x"],
    ["argv json --password", '{"args":["--password","plainword","--port","5432"]}', "plainword"],
    ["argv json -p", '["mysql","-u","root","-p","plainword"]', "plainword"],
    ["argv json --token", '["--token", "tok-plain-value"]', "tok-plain-value"],
  ];
  for (const [name, text, needle] of CASES) {
    it(name, () => {
      const out = redactString(text);
      expect(out, out).not.toContain(needle);
    });
  }

  it("redactDeep: an argv array element after a secret flag", () => {
    const out = redactDeep({ args: ["--password", "plainword", "--port", "5432"], cmd: ["mysql", "-p", "pw2pw2"], argv: ["--token", "tok123abc"] });
    expect(JSON.stringify(out)).not.toMatch(/plainword|pw2pw2|tok123abc/);
    expect(out.args[3]).toBe("5432");
  });

  it("the YAML block continuation is also caught line by line", () => {
    const out = createRedactor().lines(["password: |", "  line-one-secret", "  line-two-secret", "port: 80"]);
    expect(out.join("\n")).not.toMatch(/line-one-secret|line-two-secret/);
    expect(out[3]).toBe("port: 80");
  });

  it("does not over-redact ordinary prose", () => {
    for (const line of ["password reset email sent", "Operating system: Linux", "mapping complete", "spinner started", "user@example.com signed in", "time 10:00:00@utc"]) {
      expect(redactString(line), line).toBe(line);
    }
  });
});

describe("fuzz: a known secret never survives in any supported transformed form", () => {
  it("600 random secrets x forms", () => {
    const rand = prng(7);
    const alphabet = `${B64URL_ALPHABET}@:/?#%&=+ "'\\رمزعبور€`;
    for (let i = 0; i < 600; i++) {
      const raw = randomString(rand, alphabet, 6, 28);
      const bytes = Buffer.from(raw);
      const forms = [
        raw,
        encodeURIComponent(raw),
        JSON.stringify(raw).slice(1, -1),
        raw.toUpperCase(),
        raw.toLowerCase(),
        bytes.toString("base64"),
        bytes.toString("base64").replace(/=+$/, ""),
        bytes.toString("base64url"),
        bytes.toString("hex"),
        bytes.toString("hex").toUpperCase(),
      ];
      const form = forms[i % forms.length];
      const out = redactString(`prefix ${form} suffix`, { knownSecrets: [raw] });
      expect(out.includes(form), `${JSON.stringify(raw)} as ${JSON.stringify(form)} -> ${JSON.stringify(out)}`).toBe(false);
    }
  });

  it("stays fast with many known secrets (variants are precomputed once)", () => {
    const rand = prng(11);
    const secrets = Array.from({ length: 200 }, () => randomString(rand, B64URL_ALPHABET, 16, 40));
    const r = createRedactor({ knownSecrets: secrets });
    const lines = Array.from({ length: 5000 }, (_, i) => `2026-10-22T10:00:${String(i % 60).padStart(2, "0")}Z stdout GET /api/items/${i} 200 ${i % 97}ms`);
    const start = performance.now();
    const out = r.lines(lines);
    expect(performance.now() - start).toBeLessThan(5000);
    expect(out).toEqual(lines);
  });
});

describe("browser log views use the app's env values as known secrets", () => {
  it("GET /api/apps/[name]/logs masks transformed env values and split secrets", async () => {
    const s = loadScenario("missing-env") as unknown as {
      name: string;
      app: { project: { envs: Array<{ key: string; value: string }> } };
      logs: { data: Array<{ values: Array<[string, string]> }> };
    };
    s.app.project.envs.push({ key: "STRIPE_SECRET", value: S });
    const base = Number(s.logs.data[0].values.at(-1)![0]);
    const planted = [`cache seed ${b64(S)}`, `upper ${S.toUpperCase()}`, `half1 ${S.slice(0, 6)}`, `half2 ${S.slice(6)}`];
    planted.forEach((l, i) => s.logs.data[0].values.push([String(base + (i + 1) * 1e9), JSON.stringify({ _entry: l, type: "stdout" })]));
    const backend = agentLiara(s as never);

    vi.resetModules();
    vi.doMock("@/lib/server/liara", async (orig) => {
      const real = await orig<typeof import("@/lib/server/liara")>();
      return {
        ...real,
        api: (handler: (ctx: unknown, ...rest: unknown[]) => Promise<Response>) => (request: Request, ...rest: unknown[]) =>
          handler({ session: { token: "t", accountId: "acc-logs", teamId: "" }, liara: backend.client, request }, ...rest),
      };
    });
    const { GET } = await import("@/app/api/apps/[name]/logs/route");
    const res = await GET(new Request(`http://localhost/api/apps/${s.name}/logs?since=0&limit=2000`), { params: Promise.resolve({ name: s.name }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const needle of [S, b64(S), S.toUpperCase(), S.slice(0, 6), S.slice(6)]) expect(text, needle).not.toContain(needle);
    expect(text).toContain("cache seed");
    vi.doUnmock("@/lib/server/liara");
  });
});
