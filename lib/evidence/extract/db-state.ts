// db-state: database stopped / not RUNNING / public network off while used publicly / different network.
import { draft, SIG } from "../observe";
import type { DbFacts, DraftObservation, ExtractContext } from "../types";

const RUNNING = /^RUNNING$/i;

function stateObs(db: DbFacts): DraftObservation {
  const base = { hostname: db.hostname, engine: db.engine, status: db.status, scale: db.scale, networkName: db.networkName };
  if (db.scale === 0) {
    return draft("db_state", "liara:db", "evidence.db.stopped", "error", `database ${db.hostname} scale=0 (${db.status ?? "?"})`, { ...base, [SIG]: true });
  }
  if (db.status && !RUNNING.test(db.status)) {
    return draft("db_state", "liara:db", "evidence.db.not_running", "error", `database ${db.hostname} status=${db.status}`, { ...base, [SIG]: true });
  }
  return draft("db_state", "liara:db", "evidence.db.running", "info", `database ${db.hostname} ${db.status ?? "status unknown"}`, { ...base, [SIG]: false });
}

export function extractDbState(ctx: ExtractContext): DraftObservation[] {
  const out: DraftObservation[] = [];
  if (ctx.mode === "app") {
    for (const db of ctx.dbs) {
      out.push(stateObs(db));
      const appNet = ctx.app?.networkId;
      if (appNet && db.networkId && appNet !== db.networkId) {
        out.push(draft("db_state", "liara:db", "evidence.db.network_differs", "error",
          `app network ${ctx.app?.networkName ?? appNet} != database network ${db.networkName ?? db.networkId}`,
          { hostname: db.hostname, appNetwork: ctx.app?.networkName ?? appNet, dbNetwork: db.networkName ?? db.networkId, [SIG]: true }));
      }
    }
    return out;
  }

  const db = ctx.dbs[0];
  if (!db) return out;
  out.push(stateObs(db));
  const refs = ctx.dbApps ?? [];
  if (refs.length) {
    const apps = [...new Set(refs.map((r) => r.app))].sort();
    out.push(draft("db_state", "liara:db", "evidence.db.referenced_by", "info", `referenced by ${apps.join(", ")}`,
      { hostname: db.hostname, apps: apps.join(","), appCount: apps.length, envKeys: [...new Set(refs.map((r) => r.envKey))].sort().join(","), [SIG]: false }));
  }
  for (const r of refs) {
    if (r.networkId && db.networkId && r.networkId !== db.networkId) {
      out.push(draft("db_state", "liara:db", "evidence.db.network_differs", "error", `app ${r.app} is on another network than ${db.hostname}`,
        { hostname: db.hostname, app: r.app, envKey: r.envKey, appNetwork: r.networkId, dbNetwork: db.networkName ?? db.networkId, [SIG]: true }));
    }
    if (r.hostKind === "public" && db.publicNetwork === false) {
      out.push(draft("db_state", "liara:db", "evidence.db.public_off_but_used", "error", `app ${r.app} uses the public host but public network is off`,
        { hostname: db.hostname, app: r.app, envKey: r.envKey, publicNetwork: false, [SIG]: true }));
    }
  }
  return out;
}
