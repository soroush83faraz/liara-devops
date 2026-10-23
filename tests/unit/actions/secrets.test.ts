// Secret handling end to end: generated secrets, user-typed values and DB passwords never reach storage,
// audit, events, responses or logs. Uses the real file store in a temp dir and greps every byte written.
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "../../../lib/actions/events";
import { handleOps } from "../../../lib/actions/http/ops";
import { handleApprove, handleEvents, handleExecute } from "../../../lib/actions/http/proposals";
import { handleAudit } from "../../../lib/actions/http/incidents";
import { createFileStore } from "../../../lib/security/store";
import { body, ctxFor, propose, setup } from "./helpers";

const USER_VALUE = "typed-by-user-Zq9-SECRET-4711";

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await allFiles(p)));
    else out.push(await readFile(p, "utf8"));
  }
  return out;
}

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("no secret ever leaves the executor", () => {
  it("proposal flow: generated hex secret, user value and DB password appear nowhere", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hamyar-actions-"));
    dirs.push(dir);
    const env = setup({ store: createFileStore(dir) });
    const logged: string[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    }
    env.liara.addApp("shop", { envs: [{ key: "EXISTING", value: "existing-value-abcdef" }] });
    const db = env.liara.addDb("shop-db");
    const params = {
      type: "set_env" as const,
      app: "shop",
      changes: [
        { op: "set" as const, key: "SESSION_SECRET", valueSource: "generated" as const, generator: "hex32" as const },
        { op: "set" as const, key: "API_TOKEN", valueSource: "user" as const },
        { op: "set" as const, key: "DB_PASSWORD", valueSource: "existing" as const, from: { kind: "db" as const, name: "shop-db", field: "password" as const } },
      ],
    };
    const p = await propose(env, params);
    const busEvents: string[] = [];
    const sub = subscribe(env.accountId, p.id, (e) => busEvents.push(JSON.stringify(e.event)));

    const responses: string[] = [];
    const approveRes = await handleApprove(ctxFor(env, { body: {} }), p.id, env.deps);
    const { approvalToken } = await body<{ approvalToken: string }>(approveRes.clone());
    responses.push(await approveRes.text());
    const execRes = await handleExecute(ctxFor(env, { body: { approvalToken, userValues: { API_TOKEN: USER_VALUE } } }), p.id, env.deps);
    responses.push(await execRes.text());
    await env.settle();
    sub.unsubscribe();
    responses.push(await (await handleEvents(ctxFor(env, { method: "GET" }), p.id, env.deps)).text());
    responses.push(await (await handleAudit(ctxFor(env, { method: "GET" }), env.deps)).text());

    const envs = Object.fromEntries(env.liara.apps.get("shop")!.envs.map((e) => [e.key, e.value]));
    const generated = envs.SESSION_SECRET;
    expect(generated).toMatch(/^[a-f0-9]{64}$/);
    expect(envs.API_TOKEN).toBe(USER_VALUE);
    expect(envs.DB_PASSWORD).toBe(db.password);
    expect((await env.store.proposals.get(env.accountId, p.id))?.status).toBe("verified");

    const haystacks = { files: await allFiles(dir), busEvents, responses, logged };
    for (const [where, texts] of Object.entries(haystacks)) {
      for (const secret of [generated, USER_VALUE, db.password!, "existing-value-abcdef"]) {
        for (const t of texts) expect(t.includes(secret), `${where} leaked a secret`).toBe(false);
      }
    }
    expect(haystacks.files.length).toBeGreaterThan(0);
    expect(busEvents.length).toBeGreaterThan(0);
  });

  it("/api/ops: summary, audit and errors never echo values", async () => {
    const env = setup();
    env.liara.addApp("shop");
    const ok = await handleOps(
      ctxFor(env, { body: { params: { type: "set_env", app: "shop", changes: [{ op: "set", key: "API_TOKEN", valueSource: "user" }, { op: "set", key: "S", valueSource: "generated", generator: "base64url32" }] }, userValues: { API_TOKEN: USER_VALUE } } }),
      env.deps,
    );
    expect(ok.status).toBe(200);
    const okText = await ok.text();
    const generated = env.liara.apps.get("shop")!.envs.find((e) => e.key === "S")!.value;
    expect(okText).not.toContain(USER_VALUE);
    expect(okText).not.toContain(generated);
    expect(okText).not.toContain("knownSecrets");
    // A failing write (500 -> outcome_unknown) must not echo the value either.
    env.liara.fault("POST /v1/projects/update-envs", { status: 500, json: { message: `bad value ${USER_VALUE}` } });
    const failed = await handleOps(
      ctxFor(env, { body: { params: { type: "set_env", app: "shop", changes: [{ op: "set", key: "API_TOKEN", valueSource: "user" }] }, userValues: { API_TOKEN: `${USER_VALUE}-2` } } }),
      env.deps,
    );
    expect(failed.status).toBe(504);
    const failedText = await failed.text();
    expect(failedText).not.toContain(USER_VALUE);
    const audit = JSON.stringify(await env.store.audit.read(env.accountId));
    expect(audit).not.toContain(USER_VALUE);
    expect(audit).not.toContain(generated);
  });
});
