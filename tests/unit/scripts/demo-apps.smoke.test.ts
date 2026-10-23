import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_ROOT } from "../../../scripts/lib/scenarios";

interface Running {
  port: number;
  out: () => string;
  err: () => string;
  proc: ChildProcess;
}
const running: ChildProcess[] = [];
afterEach(() => {
  for (const p of running.splice(0)) p.kill("SIGKILL");
});

function start(id: string, env: Record<string, string> = {}): Promise<Running> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(SESSION_SECRET|DB_HOST|DB_PORT|PORT)$/.test(k)) clean[k] = v;
  const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];
  const proc = spawn(process.execPath, [join(DEMO_ROOT, id, "server.js")], { env: { ...clean, PORT: "0", ...env } as unknown as NodeJS.ProcessEnv, stdio });
  running.push(proc);
  let out = "";
  let err = "";
  proc.stderr!.on("data", (d: Buffer) => (err += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${id} did not start; stdout=${out} stderr=${err}`)), 8000);
    proc.stdout!.on("data", (d: Buffer) => {
      out += d.toString();
      const m = /Server listening on port (\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ port: Number(m[1]), out: () => out, err: () => err, proc });
      }
    });
    proc.once("exit", (code) => reject(new Error(`${id} exited early (${code}); stderr=${err}`)));
  });
}

const get = async (port: number, path: string) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, text: await res.text() };
};
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};

describe("demo app smoke (local processes, no network beyond loopback)", () => {
  it("healthy: Persian storefront, /health 200, /version, access log line", async () => {
    const s = await start("healthy");
    const home = await get(s.port, "/");
    expect(home.status).toBe(200);
    expect(home.text).toContain("فروشگاه نمونه");
    expect((await get(s.port, "/health")).status).toBe(200);
    expect(JSON.parse((await get(s.port, "/version")).text)).toEqual({ scenario: "healthy", version: "1.0.0" });
    expect((await get(s.port, "/missing")).status).toBe(404);
    await waitFor(() => /GET \/ 200 [\d.]+ ms - \d+/.test(s.out()));
    expect(s.out()).toMatch(/GET \/ 200 [\d.]+ ms - \d+/);
  });

  it("missing-secret: 500 + stack trace while SESSION_SECRET is unset, /health stays 200, recovers when set", async () => {
    const broken = await start("missing-secret");
    expect((await get(broken.port, "/")).status).toBe(500);
    expect((await get(broken.port, "/products")).status).toBe(500);
    expect((await get(broken.port, "/health")).status).toBe(200);
    expect(JSON.parse((await get(broken.port, "/version")).text).scenario).toBe("missing-secret");
    await waitFor(() => broken.err().includes("Error: SESSION_SECRET is not set"));
    expect(broken.err()).toMatch(/^Error: SESSION_SECRET is not set\n\s+at /m);
    expect(broken.out()).toMatch(/GET \/ 500 [\d.]+ ms/);
    expect(broken.proc.exitCode).toBeNull(); // process stays up

    const fixed = await start("missing-secret", { SESSION_SECRET: "set-by-test-not-a-secret" });
    expect((await get(fixed.port, "/")).status).toBe(200);
    expect(fixed.err()).toBe("");
  });

  it("db-unreachable: 500 with ECONNREFUSED host:port when the TCP connect is refused (loopback only)", async () => {
    const s = await start("db-unreachable", { DB_HOST: "127.0.0.1", DB_PORT: "1" });
    expect((await get(s.port, "/")).status).toBe(500);
    expect((await get(s.port, "/health")).status).toBe(200);
    await waitFor(() => s.err().includes("ECONNREFUSED"));
    expect(s.err()).toContain("ECONNREFUSED 127.0.0.1:1");
  });

  it("db-unreachable: reports a missing DB_HOST", async () => {
    const s = await start("db-unreachable");
    expect((await get(s.port, "/")).status).toBe(500);
    await waitFor(() => s.err().includes("DB_HOST is not set"));
    expect(s.err()).toContain("DB_HOST is not set");
  });

  it("crash-loop: boots, then dies with the documented TypeError", async () => {
    const s = await start("crash-loop", { CRASH_AFTER_MS: "100" });
    await waitFor(() => s.proc.exitCode !== null, 4000);
    expect(s.proc.exitCode).toBe(1);
    expect(s.err()).toContain("TypeError: Cannot read properties of undefined (reading 'items')");
  });

  it("cpu-bound: /report blocks for about REPORT_MS and returns 200", async () => {
    const s = await start("cpu-bound", { REPORT_MS: "300" });
    const t0 = Date.now();
    expect((await get(s.port, "/report")).status).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
    expect((await get(s.port, "/health")).status).toBe(200);
  });

  it("memory-leak: /leak retains memory and reports it", async () => {
    const s = await start("memory-leak");
    expect(JSON.parse((await get(s.port, "/leak?mb=2")).text).retainedMb).toBe(2);
    expect(JSON.parse((await get(s.port, "/leak?mb=2")).text).retainedMb).toBe(4);
  });
});
