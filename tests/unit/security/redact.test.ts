import { describe, expect, it } from "vitest";
import {
  REDACTED,
  REDACT_MAX_INPUT,
  containsSecret,
  createRedactor,
  isSecretKey,
  redactDeep,
  redactEnvValues,
  redactString,
  selectKnownSecrets,
} from "../../../lib/security/redact";
import { B64URL_ALPHABET, prng, randomString } from "../contracts/samples";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const PEM_BODY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj";

// [name, text, secrets that must not survive, knownSecrets?]
const FORMATS: Array<[string, string, string[], string[]?]> = [
  ["env password", "DB_PASSWORD=s3cr3tP@ss", ["s3cr3tP@ss"]],
  ["env passwd", "MYSQL_PASSWD=abcDEF123", ["abcDEF123"]],
  ["env pwd", "PWD_ADMIN=zz9Top!x", ["zz9Top!x"]],
  ["env secret key base", "SECRET_KEY_BASE=8f3e2a9c1d7b6e5f", ["8f3e2a9c1d7b6e5f"]],
  ["env token", "GITHUB_TOKEN=abcdef1234567890", ["abcdef1234567890"]],
  ["env api key", "OPENAI_API_KEY=xyz-123-abc", ["xyz-123-abc"]],
  ["env generic *_KEY", "STRIPE_KEY=rk_abc123xyz", ["rk_abc123xyz"]],
  ["export quoted", 'export SESSION_SECRET="quoted value 123"', ["quoted value 123"]],
  ["json password with spaces", '{"password":"p4ss w0rd with spaces"}', ["p4ss w0rd with spaces"]],
  ["json escaped quotes", '{"secret":"ab\\"cd\\"ef"}', ['ab\\"cd\\"ef', "cd"]],
  ["json pretty multi-line", '{\n  "apiKey":\n      "AbC123xyz987"\n}', ["AbC123xyz987"]],
  ["yaml", "password: hunter2!", ["hunter2!"]],
  ["php array", "'db_password' => 'Sup3r$ecret'", ["Sup3r$ecret"]],
  ["python dict", "{'token': 'tok_abcdef123456'}", ["tok_abcdef123456"]],
  ["cli flag", "mysqldump --password=Pa55word! db", ["Pa55word!"]],
  ["cli flag space-separated", "deploy --token abc123 --app shop", ["abc123"]],
  ["cli flag quoted", "keytool -storepass 'chang eit' -list", ["chang eit"]],
  ["keyword then short token", "using secret ab12cd34 for signing", ["ab12cd34"]],
  ["query access_token", "GET https://api.example.com/v1?access_token=ya29abc123&x=1", ["ya29abc123"]],
  ["query signature", "https://b.s3.amazonaws.com/f?X-Amz-Signature=abcdef0123456789&X-Amz-Credential=AKIDEXAMPLE", ["abcdef0123456789", "AKIDEXAMPLE"]],
  ["authorization bearer", "Authorization: Bearer abc.def.ghi-123", ["abc.def.ghi-123"]],
  ["authorization basic", "Authorization: Basic dXNlcjpwYXNzd29yZA==", ["dXNlcjpwYXNzd29yZA=="]],
  ["inline bearer", "calling upstream with bearer AbCdEf123456", ["AbCdEf123456"]],
  ["x-api-key header", "x-api-key: 0123456789abcdef", ["0123456789abcdef"]],
  ["cookie header", "Cookie: session=eyJhbGciOi; csrftoken=abc123", ["eyJhbGciOi", "abc123"]],
  ["set-cookie header", "Set-Cookie: sid=s%3Aabc123.def; Path=/; HttpOnly", ["s%3Aabc123.def"]],
  ["jwt standalone", `token issued ${JWT} for user`, [JWT, JWT.split(".")[2]]],
  ["jwt alg none", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.", ["eyJzdWIiOiJhZG1pbiJ9"]],
  ["liara token env", `LIARA_API_TOKEN=${JWT}`, [JWT.split(".")[1]]],
  ["opaque high-entropy token", "upstream rejected 4FvB9qL2xR7mN1pK8sT3wZ6yH0jD5gCa today", ["4FvB9qL2xR7mN1pK8sT3wZ6yH0jD5gCa"]],
  ["https url creds", "git clone https://deploy:Gh0stP4ss@git.example.com/repo.git", ["Gh0stP4ss"]],
  ["postgres url encoded", "postgres://app:pa%24%24w0rd@db-host:5432/shop", ["pa%24%24w0rd"]],
  ["mysql url unencoded specials", "mysql://root:p@ss/w:rd@mysql.internal:3306/db", ["p@ss/w:rd", "ss/w"]],
  ["mongodb+srv", "mongodb+srv://admin:M0ngoP4ss@cluster0.abcd.mongodb.net/test", ["M0ngoP4ss"]],
  ["redis no user", "redis://:R3d1sP4ss@redis-host:6379/0", ["R3d1sP4ss"]],
  ["amqps", "amqps://guest:Rabb1tP4ss@mq.internal/vhost", ["Rabb1tP4ss"]],
  ["token as url userinfo", "https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/org/repo", ["ghp_abcdefghijklmnopqrstuvwxyz0123456789"]],
  ["ado.net", "Server=db;Database=app;User Id=sa;Password=Str0ng!Pass;", ["Str0ng!Pass"]],
  ["jdbc", "jdbc:postgresql://db:5432/app?user=app&password=JdbcP4ss", ["JdbcP4ss"]],
  ["pem rsa", `-----BEGIN RSA PRIVATE KEY-----\n${PEM_BODY}\n-----END RSA PRIVATE KEY-----`, [PEM_BODY]],
  ["pem openssh", `-----BEGIN OPENSSH PRIVATE KEY-----\n${PEM_BODY}\n-----END OPENSSH PRIVATE KEY-----`, [PEM_BODY]],
  ["pem truncated", `key: -----BEGIN PRIVATE KEY-----\n${PEM_BODY}`, [PEM_BODY]],
  ["pem json escaped", `{"pk":"-----BEGIN PRIVATE KEY-----\\n${PEM_BODY}\\n-----END PRIVATE KEY-----"}`, [PEM_BODY]],
  ["aws access key id", "using AKIAIOSFODNN7EXAMPLE now", ["AKIAIOSFODNN7EXAMPLE"]],
  ["aws secret", "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", ["wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"]],
  ["github classic", `found ghp_${"aB1".repeat(12)}`, [`ghp_${"aB1".repeat(12)}`]],
  ["github fine-grained", `github_pat_11ABCDEFG0123456789_${"x".repeat(59)}`, [`11ABCDEFG0123456789_${"x".repeat(59)}`]],
  ["gitlab", "glpat-abcdefghijklmnopqrst", ["glpat-abcdefghijklmnopqrst"]],
  ["slack token", "xoxb-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx", ["AbCdEfGhIjKlMnOpQrStUvWx"]],
  ["slack webhook", "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX", ["XXXXXXXXXXXXXXXXXXXXXXXX"]],
  ["stripe", "sk_live_51HabcdefghijklmnopQRSTUV", ["sk_live_51HabcdefghijklmnopQRSTUV"]],
  ["openai project key", "sk-proj-abcdefghijklmnopqrstuvwxyz012345", ["abcdefghijklmnopqrstuvwxyz012345"]],
  ["anthropic", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz", ["abcdefghijklmnopqrstuvwxyz"]],
  ["google api key", `key AIza${"Sy0".repeat(11)}AB`, [`AIza${"Sy0".repeat(11)}AB`]],
  ["sendgrid", "SG.abcdefghijklmnopqrstuv.wxyzABCDEFGHIJKLMNOPQRSTUVWX0123456789abcd", ["wxyzABCDEFGHIJKLMNOPQRSTUVWX0123456789abcd"]],
  ["npm", `npm_${"a1B2".repeat(9)}`, [`npm_${"a1B2".repeat(9)}`]],
  ["telegram bot", "bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1 ok", ["AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1"]],
  ["huggingface", `hf_${"abcDEF123".repeat(4)}`, [`hf_${"abcDEF123".repeat(4)}`]],
  ["keyword then hex token", "api key 9f86d081884c7d659a2feaa0c55ad015", ["9f86d081884c7d659a2feaa0c55ad015"]],
  ["env pair json text", '{"key":"DB_PASSWORD","value":"hunter2!"}', ["hunter2!"]],
  ["env pair reversed", '{"value":"tok3n-v4lue","name":"API_TOKEN"}', ["tok3n-v4lue"]],
  ["xml element", "<password>XmlP4ss!</password>", ["XmlP4ss!"]],
  ["zero-width inside key", "pass\u200Bword=Zw1dthP4ss", ["Zw1dthP4ss"]],
  ["zero-width inside value", "password=abc\u200Bdef123", ["abcdef123", "abc\u200Bdef123", "def123"]],
  ["fullwidth key", "ｐａｓｓｗｏｒｄ＝FullW1dthSecret", ["FullW1dthSecret", "ＦｕｌｌＷ１ｄｔｈ"]],
  ["cyrillic homoglyph key", "pаsswоrd=H0mogl1ph", ["H0mogl1ph"]],
  ["bidi override", "password=\u202Eterces\u202C99", ["terces99", "terces"]],
  ["unicode tag smuggling", "token\uDB40\uDC20=Sm4ggl3d", ["Sm4ggl3d"]],
  ["nbsp separator", "password\u00A0=\u00A0Nbsp5ecret", ["Nbsp5ecret"]],
  ["ansi colored key", "\u001b[32mpassword\u001b[0m=Col0rSecret", ["Col0rSecret"]],
  ["nul inside key", "pass\u0000word=NulSecret1", ["NulSecret1"]],
  ["known secret plain", "connecting with correct-horse-battery to db", ["correct-horse-battery"], ["correct-horse-battery"]],
  ["known secret url-encoded", "postgres://u:p%40ss%20w%2Frd!@h/db", ["p%40ss%20w%2Frd!"], ["p@ss w/rd!"]],
  ["known secret json-escaped", JSON.stringify({ x: 'quo"te\\back' }), ['quo\\"te\\\\back'], ['quo"te\\back']],
  ["known secret persian digits", "OTP is ۸۳۹۲۰۱۷۴۴ for login", ["۸۳۹۲۰۱۷۴۴", "839201744"], ["839201744"]],
  ["known secret persian text", "رمز عبور: کلید‌محرمانه۱ تنظیم شد", ["کلید‌محرمانه۱"], ["کلید‌محرمانه۱"]],
  ["known secret repeated + overlapping", "aaaaaaaa", ["aaaaaa"], ["aaaaaa"]],
];

describe("redactString: secret formats", () => {
  it(`covers ${FORMATS.length} formats`, () => {
    expect(FORMATS.length).toBeGreaterThanOrEqual(40);
  });

  for (const [name, text, secrets, known] of FORMATS) {
    it(name, () => {
      const out = redactString(text, { knownSecrets: known });
      for (const s of secrets) expect(out.includes(s), `${name}: leaked ${JSON.stringify(s)} in ${JSON.stringify(out)}`).toBe(false);
      expect(out).toContain(REDACTED);
      expect(containsSecret(text, { knownSecrets: known })).toBe(true);
    });
  }
});

const BENIGN = [
  "2026-10-22T10:00:00.000Z GET /api/health 200 3ms",
  "Error: connect ECONNREFUSED 10.0.0.12:5432",
  "    at Server.<anonymous> (/app/server.js:12:5)",
  "npm ERR! code ELIFECYCLE",
  "Listening on port 3000",
  "release 64f1a2b3c4d5e6f7a8b9c0d1 READY",
  "image sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "trace 550e8400-e29b-41d4-a716-446655440000",
  "Killed process 123 (node) total-vm:1234kB, anon-rss:567kB",
  "signal=SIGTERM exitCode=137",
  "tests passed=10 failed=0",
  "token: undefined",
  "SESSION_SECRET=",
  "Error: SESSION_SECRET is not set",
  "Missing environment variable JWT_SECRET",
  "TypeError: Cannot read properties of undefined (reading 'token')",
  "process.env.DATABASE_URL is undefined",
  "GET http://localhost:3000/api/users?email=foo@bar.com 200",
  "postgres://db-host:5432/shop",
  "redirecting to https://example.com/login?next=/dashboard",
  "idempotency idk_2a1327cd7a673a6dd14b8d99b6eafb4788e9ae2e",
  "request req_4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a done",
  "خطا در اتصال به پایگاه داده",
  "کاربر وارد شد",
  "basic authentication required",
  "token validation failed",
  "password reset email sent",
  "Authorization header missing",
];

describe("redactString: no over-redaction of ordinary log lines", () => {
  it("leaves benign lines unchanged", () => {
    for (const line of BENIGN) expect(redactString(line), line).toBe(line);
    for (const line of BENIGN) expect(containsSecret(line), line).toBe(false);
  });
});

describe("redactString: properties", () => {
  const rand = prng(42);
  const secretOf = () => `${randomString(rand, B64URL_ALPHABET, 12, 40)}Zz9`;
  const TEMPLATES: Array<(s: string) => string> = [
    (s) => `DB_PASSWORD=${s}`,
    (s) => `{"apiKey": "${s}", "user": "x"}`,
    (s) => `password: ${s}`,
    (s) => `https://user:${s}@host.example/path`,
    (s) => `postgres://app:${s}@db:5432/x`,
    (s) => `Authorization: Bearer ${s}`,
    (s) => `GET /cb?code=${s}&state=1`,
    (s) => `x-auth-token: ${s}`,
    (s) => `secret ${s}`,
    (s) => `{"key": "STRIPE_SECRET", "value": "${s}"}`,
    (s) => `\u001b[1mtoken\u001b[22m=${s}`,
    (s) => `pass\u200Bword=${s}`,
  ];

  it("never leaks a random secret placed in a secret context (600 cases)", () => {
    for (let i = 0; i < 600; i++) {
      const s = secretOf();
      const text = `${randomString(rand, "abc xyz ", 0, 20)}${TEMPLATES[i % TEMPLATES.length](s)}${randomString(rand, " abc,;", 0, 10)}`;
      const out = redactString(text);
      expect(out.includes(s), `${JSON.stringify(text)} -> ${JSON.stringify(out)}`).toBe(false);
    }
  });

  it("never leaks a known secret in raw, URL-encoded or JSON-escaped form (400 cases)", () => {
    const alphabet = `${B64URL_ALPHABET}@:/?#%&=+ "'\\رمزعبور€😀`;
    for (let i = 0; i < 400; i++) {
      const raw = randomString(rand, alphabet, 6, 24);
      const forms = [raw, encodeURIComponent(raw), JSON.stringify(raw).slice(1, -1)];
      const form = forms[i % forms.length];
      const out = redactString(`prefix ${form} suffix`, { knownSecrets: [raw] });
      expect(out.includes(form), `${JSON.stringify(raw)} as ${JSON.stringify(form)} -> ${JSON.stringify(out)}`).toBe(false);
    }
  });

  it("is idempotent", () => {
    for (const [, text, , known] of FORMATS) {
      const once = redactString(text, { knownSecrets: known });
      expect(redactString(once, { knownSecrets: known })).toBe(once);
    }
  });

  it("ignores known secrets shorter than 6 characters", () => {
    expect(redactString("the port is 5432", { knownSecrets: ["5432", ""] })).toBe("the port is 5432");
  });

  it("createRedactor matches the one-shot functions", () => {
    const r = createRedactor({ knownSecrets: ["correct-horse-battery"] });
    for (const [, text] of FORMATS) expect(r.string(text)).toBe(redactString(text, { knownSecrets: ["correct-horse-battery"] }));
    expect(r.contains("x correct-horse-battery")).toBe(true);
  });
});

describe("redactString: hostile input", () => {
  const HOSTILE = [
    "a".repeat(200_000),
    "a:".repeat(100_000),
    "x://y:".repeat(30_000),
    "@".repeat(200_000),
    "password=".repeat(20_000),
    "eyJ".repeat(60_000) + ".",
    "-----BEGIN PRIVATE KEY-----".repeat(5_000),
    '"password":"'.repeat(10_000) + "\\".repeat(10_000),
    "A1a".repeat(70_000),
    "token ".repeat(30_000),
    '{"key":"'.repeat(20_000),
    "postgres://u:".repeat(15_000),
    "<password>".repeat(20_000),
    "Bearer ".repeat(30_000),
  ];

  it("runs in linear-ish time on adversarial strings", () => {
    for (const text of HOSTILE) {
      const start = performance.now();
      redactString(text, { knownSecrets: ["aaaaaa"] });
      expect(performance.now() - start, text.slice(0, 20)).toBeLessThan(2000);
    }
  });

  it("truncates huge inputs at a boundary without leaking a split secret", () => {
    const secret = `Zx9${"q".repeat(40)}Kk1`;
    const text = `${"word ".repeat(REDACT_MAX_INPUT / 5)}${secret}`;
    const out = redactString(text, { knownSecrets: [secret] });
    expect(out.length).toBeLessThanOrEqual(REDACT_MAX_INPUT + 20);
    expect(out).toContain("«truncated»");
    expect(out.includes(secret.slice(0, 10))).toBe(false);
  });
});

describe("redactDeep", () => {
  it("redacts values under secret-ish keys at any depth", () => {
    const out = redactDeep({
      user: "bob",
      password: "hunter2",
      nested: { deeper: { apiKey: "k-123", count: 3 } },
      credentials: { user: "u", pass: "p", list: ["a", "b"] },
      root_password: 1234567,
      hasPassword: true,
      list: [{ token: "t1" }, { token: "t2" }],
    });
    expect(out).toEqual({
      user: "bob",
      password: REDACTED,
      nested: { deeper: { apiKey: REDACTED, count: 3 } },
      credentials: { user: REDACTED, pass: REDACTED, list: [REDACTED, REDACTED] },
      root_password: REDACTED,
      hasPassword: true,
      list: [{ token: REDACTED }, { token: REDACTED }],
    });
  });

  it("redacts secrets split across JSON keys and key/value pairs", () => {
    expect(redactDeep({ pass_part1: "hun", pass_part2: "ter2" })).toEqual({ pass_part1: REDACTED, pass_part2: REDACTED });
    expect(redactDeep({ Name: "API_TOKEN", Value: "v-1" })).toEqual({ Name: "API_TOKEN", Value: REDACTED });
    expect(redactDeep([{ key: "DB_PASSWORD", value: "x1" }, { key: "LOG_LEVEL", value: "debug" }])).toEqual([
      { key: "DB_PASSWORD", value: REDACTED },
      { key: "LOG_LEVEL", value: "debug" },
    ]);
  });

  it("redacts every value inside env containers (array and record form)", () => {
    const app = {
      name: "shop",
      envs: [
        { key: "NODE_ENV", value: "production" },
        { key: "PUBLIC_URL", value: "https://shop.example.ir" },
        { key: "EMPTY", value: "" },
      ],
      environment: { FEATURE_FLAG: "on", PORT: 3000 },
    };
    expect(redactDeep(app)).toEqual({
      name: "shop",
      envs: [
        { key: "NODE_ENV", value: REDACTED },
        { key: "PUBLIC_URL", value: REDACTED },
        { key: "EMPTY", value: "" },
      ],
      environment: { FEATURE_FLAG: REDACTED, PORT: REDACTED },
    });
  });

  it("pattern-redacts free text, keys, errors, maps and known secrets", () => {
    const err = new Error("connect failed: postgres://app:Pg5ecret@db/x");
    const out = redactDeep(
      {
        log: "DB_PASSWORD=abc12345",
        ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIz"]: 1,
        err,
        map: new Map([["password", "m1"]]),
        set: new Set(["fine", "uses Kn0wnSecret!"]),
      },
      { knownSecrets: ["Kn0wnSecret!"] },
    ) as Record<string, unknown>;
    const json = JSON.stringify(out);
    for (const leak of ["abc12345", "Pg5ecret", "eyJzdWIiOiIxIn0", "m1", "Kn0wnSecret!"]) expect(json.includes(leak), leak).toBe(false);
    expect((out.err as { message: string }).message).toContain(REDACTED);
  });

  it("handles cycles, depth, binary and prototype keys safely", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(redactDeep(cyclic)).toEqual({ a: 1, self: "«circular»" });
    let deep: Record<string, unknown> = { v: "x" };
    for (let i = 0; i < 100; i++) deep = { d: deep };
    expect(JSON.stringify(redactDeep(deep))).toContain("«truncated»");
    expect(redactDeep({ b: Buffer.from("secret") })).toEqual({ b: "«binary»" });
    const shared = { password: "x" };
    expect(redactDeep({ a: shared, b: shared })).toEqual({ a: { password: REDACTED }, b: { password: REDACTED } });
    const polluted = redactDeep(JSON.parse('{"__proto__": {"isAdmin": true}, "ok": 1}') as Record<string, unknown>);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(polluted)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(polluted, "__proto__")).toBe(true);
  });

  it("does not mutate its input", () => {
    const input = { password: "x", nested: { token: "y" } };
    const copy = structuredClone(input);
    redactDeep(input);
    expect(input).toEqual(copy);
  });
});

describe("env helpers", () => {
  it("redactEnvValues masks every value, keeps keys, keeps emptiness", () => {
    expect(redactEnvValues([{ key: "A", value: "1" }, { key: "B", value: "" }, { key: "C" }])).toEqual([
      { key: "A", value: REDACTED },
      { key: "B", value: "" },
      { key: "C", value: "" },
    ]);
    const record = redactEnvValues(JSON.parse('{"__proto__": "x", "SECRET": "y"}') as Record<string, unknown>);
    expect(record.SECRET).toBe(REDACTED);
    expect(({} as Record<string, unknown>).SECRET).toBeUndefined();
    expect(JSON.stringify(redactEnvValues([{ key: "K", value: "leak-me", extra: "leak-too" } as { key: string; value: string }]))).not.toMatch(/leak/);
  });

  it("selectKnownSecrets keeps env values and DB passwords, skips standard words and short values", () => {
    const known = selectKnownSecrets({
      envs: [
        { key: "NODE_ENV", value: "production" },
        { key: "PORT", value: "3000" },
        { key: "SESSION_SECRET", value: "abcdef123456" },
        { key: "PUBLIC_URL", value: "https://shop.example.ir" },
      ],
      values: ["dbP4ssword", null, undefined, "short"],
    });
    expect(known.sort()).toEqual(["abcdef123456", "dbP4ssword", "https://shop.example.ir"].sort());
  });

  it("isSecretKey recognizes secret-ish names and leaves ordinary ones", () => {
    for (const k of [
      "DB_PASSWORD",
      "password",
      "PGPASSWORD",
      "apiKey",
      "x-api-key",
      "root_password",
      "clientSecret",
      "STRIPE_KEY",
      "sessionId",
      "authToken",
      "private_key",
      "accessKeyId",
      "Authorization",
      "cookie",
      "pass",
      "jwt",
    ]) {
      expect(isSecretKey(k), k).toBe(true);
    }
    for (const k of ["key", "name", "value", "paramsHash", "proposalId", "idempotencyKey", "primaryKey", "publicKey", "author", "passenger", "signal", "passed", "compass", "keyboard", "monkey"]) {
      expect(isSecretKey(k), k).toBe(false);
    }
  });
});
