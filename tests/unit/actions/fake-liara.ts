// SYNTHETIC in-memory Liara used by the actions tests. Not recorded from Liara: endpoint shapes follow
// lib/liara (OpenAPI/CLI-derived). It sits behind the REAL client (createLiaraClient + fake fetch), so the
// client's own rules (GET-only retries, error classification, timeouts) are exercised too.
import { createLiaraClient, type LiaraClient } from "../../../lib/liara";

export interface Clock {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function fakeClock(start = Date.parse("2026-10-22T08:00:00.000Z")): Clock & { advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += Math.max(0, ms);
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export interface Env {
  key: string;
  value: string;
  encrypted?: boolean;
}
export interface FakeApp {
  name: string;
  type: string;
  planID: string;
  bundlePlanID?: string;
  scale: number;
  status: string;
  network?: { _id: string; name: string };
  envs: Env[];
  defaultSubdomain?: boolean;
  isDeployed?: boolean;
}
export interface FakeRelease {
  _id: string;
  state: string;
  imageName?: string;
  sourceID?: string;
  port?: number;
  type?: string;
  createdAt: string;
  tag?: string;
  sourceAvailable?: boolean;
  failReason?: string;
}
export interface FakeApplet {
  name: string;
  state: string;
  timestamp: string;
}
export interface FakeDb {
  _id: string;
  hostname: string;
  type: string;
  planID: string;
  bundlePlanID?: string;
  status: string;
  scale: number;
  network?: { _id: string; name: string } | null;
  internalPort?: number;
  username?: string;
  password?: string;
  dbName?: string;
  publicNetwork?: boolean;
}
/** Container lifecycle event as served by GET /v1/projects/{name}/events (live shape 2026-10-23). */
export interface FakeEvent {
  action: string;
  tsMs: number;
  release?: string;
}
export interface LogEntry {
  tsMs: number;
  message: string;
  stream?: "stdout" | "stderr";
  /** Release whose container wrote the line; served as the v2 group's `metaData.releaseId`. */
  releaseId?: string;
}

/** `applied: true` = the change is made first and only the response is lost (the dangerous case). */
export type Fault =
  | { status: number; json?: unknown; /** Verbatim body (e.g. an HTML error page); wins over `json`. */ raw?: string; once?: boolean; applied?: boolean }
  | { network: true; once?: boolean; applied?: boolean }
  | { hang: true; once?: boolean; applied?: boolean };

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

const PLANS_ME = {
  user: { _id: "u1", email: "user@example.invalid" },
  databaseVersions: { postgres: [{ label: "16", value: "16" }], redis: [{ label: "7", value: "7" }] },
  plans: {
    projects: {
      "small-g2": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 100 },
      "big-g2": { available: true, region: "iran", RAM: { amount: 4 }, CPU: { amount: 2 }, volume: 20, price: 400 },
      "gone-g2": { available: false, region: "iran", price: 50 },
      free: { available: true, region: "iran", price: 0 },
    },
    projectBundlePlans: {
      "small-g2": { standard: { available: true, displayPrice: 50000 } },
      "big-g2": { standard: { available: true, displayPrice: 50000 }, pro: { available: true, displayPrice: 120000 } },
    },
    databases: { "db-small-g2": { available: true, region: "iran", price: 60, supports: ["postgres", "mysql"] } },
    databaseBundlePlans: { "db-small-g2": { standard: { available: true, displayPrice: 10000 } } },
  },
};

const json = (status: number, body: unknown) => ({ status, body });
/** The fake's project `_id` for an app name (what the disk routes need). */
export const projectId = (name: string) => `id_${name}`;

export class FakeLiara {
  apps = new Map<string, FakeApp>();
  releases = new Map<string, FakeRelease[]>();
  current = new Map<string, string>();
  applets = new Map<string, FakeApplet[]>();
  dbs: FakeDb[] = [];
  networks: Array<{ _id: string; name: string }> = [];
  domains: Array<{ _id: string; name: string; project: string }> = [];
  disks = new Map<string, Array<{ name: string }>>();
  /** Disks mounted by the latest release body (`disks:[{name,mountTo}]`); served as `mounts` of the disks listing. */
  mounts = new Map<string, Array<{ name: string; mountedTo: string }>>();
  logs = new Map<string, LogEntry[]>();
  /** Lifecycle events per app; restarts append `create` + `start`. Served newest first, `time` in unix seconds. */
  events = new Map<string, FakeEvent[]>();
  me: unknown = PLANS_ME;
  balance: number | undefined = 1_000_000;
  /** When set, `GET /v1/billing` answers exactly this body (e.g. the recorded dual user+team shape). */
  billingBody?: unknown;
  /** Polls of a non-terminal release before it becomes `finalState`. */
  releaseDelay = 1;
  releaseFinalState = "READY";
  /** Build output served by GET /v2/releases/{id}/build-logs, and the failReason set when a release ends non-READY. */
  buildOutput: Array<{ line: string; stream: "STDOUT" | "STDERR" }> = [];
  releaseFailReason?: string;
  /** When false, restarts/env updates keep the old applet names (an in-place restart). */
  replaceAppletsOnRestart = true;
  /** Runs after update-envs stored the list (simulate a Liara that drops or alters variables). */
  envUpdateHook?: (app: FakeApp) => void;
  calls: Call[] = [];
  faults = new Map<string, Fault>();
  private releasePolls = new Map<string, number>();
  private seq = 0;

  constructor(readonly clock: Clock) {}

  /* ------------------------------------------------------------ fixtures */

  addApp(name: string, over: Partial<FakeApp> = {}): FakeApp {
    const app: FakeApp = { name, type: "node", planID: "small-g2", bundlePlanID: "standard", scale: 1, status: "RUNNING", network: { _id: "n1", name: "main" }, envs: [], defaultSubdomain: true, isDeployed: true, ...over };
    this.apps.set(name, app);
    const rel: FakeRelease = { _id: `rel_${name}_init`, state: "READY", imageName: `registry.example/${name}:v1`, port: 3000, type: "node", createdAt: new Date(this.clock.now() - 3_600_000).toISOString(), tag: "v1" };
    this.releases.set(name, [rel]);
    this.current.set(name, rel._id);
    this.applets.set(name, [{ name: `${name}-pod-a`, state: "Running", timestamp: new Date(this.clock.now() - 3_600_000).toISOString() }]);
    return app;
  }

  addDb(hostname: string, over: Partial<FakeDb> = {}): FakeDb {
    const db: FakeDb = { _id: `db_${hostname}`, hostname, type: "postgres", planID: "db-small-g2", bundlePlanID: "standard", status: "RUNNING", scale: 1, network: { _id: "n1", name: "main" }, internalPort: 5432, username: "root", password: "SYNTH-db-pass-0123456789", dbName: "appdb", publicNetwork: false, ...over };
    this.dbs.push(db);
    return db;
  }

  log(app: string, message: string, tsMs = this.clock.now(), releaseId?: string): void {
    const list = this.logs.get(app) ?? [];
    list.push({ tsMs, message, ...(releaseId ? { releaseId } : {}) });
    this.logs.set(app, list);
  }

  event(app: string, action: string, tsMs: number, release?: string): void {
    const list = this.events.get(app) ?? [];
    list.push({ action, tsMs, release });
    this.events.set(app, list);
  }

  fault(route: string, f: Fault): void {
    this.faults.set(route, f);
  }

  mutations(): Call[] {
    return this.calls.filter((c) => c.method !== "GET");
  }

  /* ------------------------------------------------------------- client */

  client(opts: { teamId?: string; timeoutMs?: number } = {}): LiaraClient {
    return createLiaraClient({
      token: "tok_SYNTHETIC_actions_0123456789",
      teamId: opts.teamId,
      fetchImpl: this.fetchImpl,
      retryBaseDelayMs: 0,
      timeoutMs: opts.timeoutMs ?? 2000,
    });
  }

  readonly fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body instanceof FormData) body = { form: [...init.body.keys()] };
    this.calls.push({ method, path: url.pathname, body });
    const route = `${method} ${url.pathname}`;
    const fault = this.faults.get(route);
    if (fault) {
      if (fault.once) this.faults.delete(route);
      if (fault.applied) this.handle(method, url, body);
      if ("hang" in fault) {
        await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")), { once: true }));
      }
      if ("network" in fault) throw new TypeError("fetch failed");
      if ("status" in fault) return new Response(fault.raw ?? JSON.stringify(fault.json ?? { statusCode: fault.status, message: "synthetic failure" }), { status: fault.status });
    }
    const r = this.handle(method, url, body);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;

  /* ------------------------------------------------------------- router */

  private restartApplets(name: string): void {
    const now = new Date(this.clock.now() + 1).toISOString();
    const prev = this.applets.get(name) ?? [];
    this.event(name, "create", this.clock.now() + 1, this.current.get(name));
    this.event(name, "start", this.clock.now() + 1, this.current.get(name));
    this.applets.set(
      name,
      this.replaceAppletsOnRestart ? [{ name: `${name}-pod-${++this.seq}`, state: "Running", timestamp: now }] : prev.map((a) => ({ ...a })),
    );
  }

  /** A building release progresses each time anyone observes it (by id or in the list). */
  private tick(appName: string, rel: FakeRelease): void {
    if (rel.state !== "BUILDING") return;
    const n = (this.releasePolls.get(rel._id) ?? 0) + 1;
    this.releasePolls.set(rel._id, n);
    if (n <= this.releaseDelay) return;
    rel.state = this.releaseFinalState;
    if (rel.state !== "READY" && this.releaseFailReason) rel.failReason = this.releaseFailReason;
    if (rel.state === "READY") {
      this.current.set(appName, rel._id);
      this.restartApplets(appName);
      const app = this.apps.get(appName);
      if (app) app.isDeployed = true;
    }
  }

  private appView(a: FakeApp) {
    return { _id: projectId(a.name), project_id: a.name, type: a.type, planID: a.planID, bundlePlanID: a.bundlePlanID, scale: a.scale, status: a.status, network: a.network, envs: a.envs.map((e) => ({ ...e })), defaultSubdomain: a.defaultSubdomain, isDeployed: a.isDeployed };
  }

  private dbSummary(d: FakeDb) {
    return { _id: d._id, hostname: d.hostname, type: d.type, planID: d.planID, bundlePlanID: d.bundlePlanID, status: d.status, scale: d.scale, internalPort: d.internalPort, publicNetwork: d.publicNetwork };
  }

  private handle(method: string, url: URL, body: unknown): { status: number; body?: unknown } {
    const p = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const b = (body ?? {}) as Record<string, unknown>;
    const nf = json(404, { statusCode: 404, message: "not found" });
    const key = `${method} /${p.slice(0, 2).join("/")}`;

    // ---- /v1/projects
    if (method === "GET" && p.join("/") === "v1/projects") return json(200, { projects: [...this.apps.values()].map((a) => this.appView(a)) });
    if (method === "POST" && p.join("/") === "v1/projects") {
      const name = String(b.name);
      if (this.apps.has(name)) return json(409, { message: "duplicate" });
      const network = typeof b.network === "string" ? this.networks.find((n) => n._id === b.network) : undefined;
      this.apps.set(name, { name, type: String(b.platform), planID: String(b.planID), bundlePlanID: String(b.bundlePlanID), scale: 1, status: "RUNNING", network, envs: [], isDeployed: false });
      this.releases.set(name, []);
      this.applets.set(name, []);
      return json(200, undefined);
    }
    if (method === "POST" && p.join("/") === "v1/projects/update-envs") {
      const app = this.apps.get(String(b.project));
      if (!app) return nf;
      app.envs = (b.variables as Env[]).map((v) => ({ key: v.key, value: v.value }));
      this.envUpdateHook?.(app);
      this.restartApplets(app.name);
      return json(200, { message: "ok" });
    }
    if (method === "POST" && p.join("/") === "v1/projects/update-port") {
      const app = this.apps.get(String(b.project));
      if (!app) return nf;
      this.restartApplets(app.name);
      return json(200, {});
    }
    if (p[0] === "v1" && p[1] === "projects" && p[2]) {
      // Like live (2026-10-23): a project resolves by name OR by `_id`; the disk routes only work by `_id` (create by name).
      const byName = this.apps.get(p[2]);
      const app = byName ?? [...this.apps.values()].find((a) => projectId(a.name) === p[2]);
      if (!app) return nf;
      const rest = p.slice(3).join("/");
      if (p[3] === "disks" && byName && !(method === "POST" && rest === "disks")) return json(500, { error: "Internal Server Error" });
      if (method === "GET" && rest === "") return json(200, { project: this.appView(app) });
      if (method === "DELETE" && rest === "") {
        this.apps.delete(app.name);
        this.disks.delete(app.name);
        this.mounts.delete(app.name);
        return json(200, {});
      }
      if (method === "POST" && rest === "actions/restart") {
        this.restartApplets(app.name);
        return json(200, {});
      }
      if (method === "POST" && rest === "actions/scale") {
        app.scale = Number(b.scale);
        this.applets.set(app.name, app.scale === 0 ? [] : [{ name: `${app.name}-pod-${++this.seq}`, state: "Running", timestamp: new Date(this.clock.now() + 1).toISOString() }]);
        return json(200, {});
      }
      if (method === "POST" && rest === "resize") {
        app.planID = String(b.planID);
        return json(200, {});
      }
      if (method === "GET" && rest === "applets") return json(200, { applets: this.applets.get(app.name) ?? [] });
      if (method === "GET" && rest === "events") {
        const data = [...(this.events.get(app.name) ?? [])]
          .sort((a, b) => b.tsMs - a.tsMs)
          .map((e, i) => ({ id: `ev_${i}`, status: e.action, action: e.action, time: String(Math.floor(e.tsMs / 1000)), release: e.release ?? "", tag: "v1" }));
        return json(200, { data });
      }
      if (method === "GET" && rest === "releases") {
        for (const r of this.releases.get(app.name) ?? []) this.tick(app.name, r);
        const list = [...(this.releases.get(app.name) ?? [])].reverse();
        return json(200, { releases: list, currentRelease: this.current.get(app.name), total: list.length });
      }
      if (method === "GET" && rest === "disks") return json(200, { disks: this.disks.get(app.name) ?? [], mounts: this.mounts.get(app.name) ?? [] });
      if (method === "POST" && rest === "disks") {
        const list = this.disks.get(app.name) ?? [];
        if (list.some((d) => d.name === b.name)) return json(409, { message: "duplicate" });
        this.disks.set(app.name, [...list, { name: String(b.name) }]);
        return json(200, {});
      }
      if (method === "DELETE" && p[3] === "disks" && p[4]) {
        const list = this.disks.get(app.name) ?? [];
        if (!list.some((d) => d.name === p[4])) return nf;
        this.disks.set(app.name, list.filter((d) => d.name !== p[4]));
        return json(200, {});
      }
    }
    // ---- /v2 releases, sources, logs
    if (p[0] === "v2" && p[1] === "projects" && p[2]) {
      const app = this.apps.get(p[2]);
      if (!app) return nf;
      if (method === "POST" && p[3] === "sources") return json(200, { sourceID: `src_${++this.seq}` });
      if (method === "POST" && p[3] === "releases") {
        const rel: FakeRelease = { _id: `rel_${app.name}_${++this.seq}`, state: "BUILDING", imageName: typeof b.image === "string" ? b.image : undefined, port: Number(b.port), type: String(b.type), createdAt: new Date(this.clock.now()).toISOString() };
        this.releases.set(app.name, [...(this.releases.get(app.name) ?? []), rel]);
        if (Array.isArray(b.disks)) this.mounts.set(app.name, (b.disks as Array<{ name: string; mountTo: string }>).map((d) => ({ name: d.name, mountedTo: d.mountTo })));
        else this.mounts.delete(app.name);
        return json(200, { releaseID: rel._id });
      }
      if (method === "GET" && p[3] === "logs") {
        const start = Number(url.searchParams.get("start") ?? "0") * 1000;
        // Like live v2: one group per release (`metaData.releaseId`); lines logged without a release share a bare group.
        const groups = new Map<string, Array<[string, string]>>();
        for (const l of (this.logs.get(app.name) ?? []).filter((x) => x.tsMs >= start)) {
          const k = l.releaseId ?? "";
          groups.set(k, [...(groups.get(k) ?? []), [`${l.tsMs}000000`, JSON.stringify({ _entry: l.message, type: l.stream ?? "stdout" })]]);
        }
        const data = [...groups].map(([releaseId, values]) => ({ metaData: releaseId ? { releaseId } : {}, values }));
        return json(200, { data: data.length ? data : [{ metaData: {}, values: [] }] });
      }
    }
    if ((p[0] === "v1" && p[1] === "releases") || (p[0] === "v2" && p[1] === "releases")) {
      const id = p[2];
      for (const [appName, list] of this.releases) {
        const rel = list.find((r) => r._id === id);
        if (!rel) continue;
        this.tick(appName, rel);
        if (p[3] === "build-logs") return json(200, { release: { ...rel }, buildOutput: this.buildOutput.map((l, i) => ({ _id: `bl_${i}`, line: l.line, stream: l.stream, releaseID: rel._id, createdAt: new Date(this.clock.now() + i).toISOString() })) });
        return json(200, { release: { ...rel } });
      }
      return nf;
    }
    // ---- databases
    if (method === "GET" && p.join("/") === "v1/databases") return json(200, { databases: this.dbs.map((d) => this.dbSummary(d)) });
    if (method === "POST" && p.join("/") === "v1/databases") {
      if (this.dbs.some((d) => d.hostname === b.hostname)) return json(409, { message: "duplicate" });
      const network = typeof b.network === "string" ? this.networks.find((n) => n._id === b.network) : undefined;
      const db = this.addDb(String(b.hostname), { type: String(b.type), planID: String(b.planID), network: network ?? null, status: "RUNNING" });
      return json(200, { databaseID: db._id });
    }
    if (p[0] === "v1" && p[1] === "databases" && p[2]) {
      const db = this.dbs.find((d) => d._id === p[2]);
      if (!db) return nf;
      const rest = p.slice(3).join("/");
      if (method === "GET" && rest === "") {
        return json(200, { database: { ...this.dbSummary(db), network: db.network, username: db.username, root_password: db.password, dbName: db.dbName, port: 31337, node: { host: "198.51.100.7" } } });
      }
      if (method === "DELETE" && rest === "") {
        this.dbs = this.dbs.filter((d) => d !== db);
        return json(200, {});
      }
      if (method === "POST" && rest === "actions/scale") {
        db.scale = Number(b.scale);
        db.status = db.scale === 0 ? "STOPPED" : "RUNNING";
        return json(200, {});
      }
      if (method === "POST" && rest === "resize") {
        db.planID = String(b.planID);
        return json(200, {});
      }
    }
    // ---- networks, domains, account
    if (method === "GET" && p.join("/") === "v1/networks") return json(200, { networks: this.networks });
    if (method === "POST" && p.join("/") === "v1/networks") {
      if (this.networks.some((n) => n.name === b.networkName)) return json(409, { message: "duplicate" });
      this.networks.push({ _id: `net_${++this.seq}`, name: String(b.networkName) });
      return json(200, {});
    }
    if (method === "GET" && p.join("/") === "v1/domains") return json(200, { domains: this.domains.map((d) => ({ _id: d._id, name: d.name, project: { project_id: d.project } })) });
    if (method === "DELETE" && p[0] === "v1" && p[1] === "domains" && p[2]) {
      if (!this.domains.some((d) => d._id === p[2])) return nf;
      this.domains = this.domains.filter((d) => d._id !== p[2]);
      return json(200, {});
    }
    if (method === "GET" && p.join("/") === "v1/me") return json(200, this.me);
    if (method === "GET" && p.join("/") === "v1/billing") return json(200, this.billingBody ?? { user: { balance: this.balance } });
    void key;
    return nf;
  }
}
