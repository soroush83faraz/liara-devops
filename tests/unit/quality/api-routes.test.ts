// Guards over app/api/**/route.ts: every handler goes through the shared wrapper (auth, origin check, safe errors).
import { describe, expect, it } from "vitest";
import { listFiles, read, stripComments } from "./scan";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes that may export unwrapped handlers (path -> reason). Both are public by design.
 *  - session: this IS the login; it validates the token itself and checks the origin explicitly.
 *  - health: unauthenticated liveness probe for the platform.
 */
const UNWRAPPED_ALLOWLIST: Record<string, string> = {
  "app/api/session/route.ts": "login/logout endpoint: validates the token against Liara itself and calls isSameOrigin",
  "app/api/health/route.ts": "unauthenticated liveness probe; returns no data from the session or Liara",
};

interface Handler {
  file: string;
  method: string;
  wrapped: boolean;
  /** The exported declaration text (up to the first line break after `=` or the function header). */
  head: string;
}

function parseHandlers(file: string, rawCode: string): Handler[] {
  const out: Handler[] = [];
  const code = stripComments(rawCode);
  for (const method of METHODS) {
    const asConst = new RegExp(`export\\s+const\\s+${method}\\s*(?::[^=]+)?=\\s*([\\s\\S]{0,60})`).exec(code);
    const asFn = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`).exec(code);
    if (!asConst && !asFn) continue;
    const wrapped = asConst ? /^(?:api|withSession)\s*[(<]/.test(asConst[1]) : false;
    const usesRunUserOp = asFn ? /runUserOp\s*\(/.test(code.slice(asFn.index)) : false;
    out.push({ file, method, wrapped: wrapped || usesRunUserOp, head: (asConst?.[0] ?? asFn?.[0] ?? "").replace(/\s+/g, " ") });
  }
  return out;
}

function handlers(): Handler[] {
  return listFiles(["app/api"], ["route.ts"]).flatMap((file) => parseHandlers(file, read(file)));
}

describe("API route guards", () => {
  const all = handlers();

  it("the parser classifies wrapped and unwrapped handlers correctly", () => {
    const wrapped = parseHandlers("x", "export const GET = api(async (ctx) => Response.json({}));\nexport const POST = withSession(async () => new Response());");
    expect(wrapped.map((h) => [h.method, h.wrapped])).toEqual([["GET", true], ["POST", true]]);
    const bare = parseHandlers("x", "export async function DELETE(req: Request) { return new Response(); }\nexport const PUT = handler;\n// export const PATCH = api(x)");
    expect(bare.map((h) => [h.method, h.wrapped])).toEqual([["PUT", false], ["DELETE", false]]);
    const viaRun = parseHandlers("x", "export async function POST(r: Request) { return runUserOp({}); }");
    expect(viaRun[0].wrapped).toBe(true);
  });

  it("finds the route handlers (sanity)", () => {
    expect(listFiles(["app/api"], ["route.ts"]).length).toBeGreaterThan(30);
    expect(all.length).toBeGreaterThan(40);
  });

  it("every exported handler is wrapped by api()/withSession()/runUserOp() or explicitly allowlisted", () => {
    const unwrapped = all.filter((h) => !h.wrapped && !(h.file in UNWRAPPED_ALLOWLIST)).map((h) => `${h.file}  ${h.method}  ${h.head.slice(0, 70)}`);
    expect(unwrapped, "Wrap with api() from @/lib/server/liara (session + origin check + safe errors), or add an allowlist entry with a reason:").toEqual([]);
  });

  it("every route file exports at least one handler (no dead route files)", () => {
    const withHandlers = new Set(all.map((h) => h.file));
    const empty = listFiles(["app/api"], ["route.ts"]).filter((f) => !withHandlers.has(f));
    expect(empty).toEqual([]);
  });

  it("mutating handlers are origin-checked (via api() or isSameOrigin)", () => {
    const bad = all
      .filter((h) => MUTATING.has(h.method))
      .filter((h) => {
        const code = stripComments(read(h.file));
        const viaApi = /export\s+const\s+\w+\s*=\s*api\s*[(<]/.test(code) && new RegExp(`export\\s+const\\s+${h.method}\\s*=\\s*api\\s*[(<]`).test(code);
        const viaRunUserOp = /runUserOp\s*\(/.test(code);
        return !(viaApi || viaRunUserOp || /isSameOrigin\s*\(/.test(code));
      })
      .map((h) => `${h.file}  ${h.method}`);
    expect(bad, "A cookie-authenticated mutation without an Origin check is CSRF-able. Use api() or call isSameOrigin(request):").toEqual([]);
  });

  it("allowlisted unwrapped routes check the origin on every mutating method", () => {
    for (const file of Object.keys(UNWRAPPED_ALLOWLIST)) {
      const code = stripComments(read(file));
      for (const h of all.filter((x) => x.file === file && MUTATING.has(x.method))) {
        const body = code.slice(code.search(new RegExp(`function\\s+${h.method}\\b`)));
        expect(/isSameOrigin\s*\(/.test(body.slice(0, 600)), `${file} ${h.method} must call isSameOrigin first`).toBe(true);
      }
    }
  });

  it("the api() wrapper itself rejects cross-origin non-GET requests", () => {
    const src = stripComments(read("lib/server/liara.ts"));
    expect(src).toMatch(/!isSameOrigin\(request\)/);
    expect(src).toMatch(/method !== "GET"/);
  });
});
