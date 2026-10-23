// applet-state: pods that are not running (or unhealthy), plus a summary of running ones.
import { draft, SIG } from "../observe";
import type { DraftObservation, ExtractContext } from "../types";

const RUNNING = /^running$/i;
const UNHEALTHY = /unhealthy|not ?ready|readiness|liveness|probe failed/i;

export function extractAppletState(ctx: ExtractContext): DraftObservation[] {
  const out: DraftObservation[] = [];
  let running = 0;
  for (const a of ctx.applets) {
    const state = a.state ?? "unknown";
    const reason = a.reason ?? "";
    if (RUNNING.test(state) && !UNHEALTHY.test(reason)) {
      running++;
      continue;
    }
    const unhealthy = UNHEALTHY.test(`${state} ${reason}`);
    out.push(draft("applet_state", "liara:applets", unhealthy ? "evidence.applet.unhealthy" : "evidence.applet.not_running", "warn",
      `${a.name ?? "applet"}: ${state}${reason ? ` (${reason})` : ""}`,
      { applet: a.name, state, reason, releaseTag: a.releaseTag, unhealthy, [SIG]: false }, a.timestamp));
  }
  if (ctx.applets.length) {
    out.push(draft("applet_state", "liara:applets", "evidence.applet.summary", running === ctx.applets.length ? "info" : "warn",
      `${running}/${ctx.applets.length} applets running`, { running, total: ctx.applets.length, [SIG]: false }));
  } else if (ctx.appletsKnown !== false && ctx.app && (ctx.app.scale ?? 1) > 0) {
    out.push(draft("applet_state", "liara:applets", "evidence.applet.none", "warn", "no applets reported", { running: 0, total: 0, scale: ctx.app.scale, [SIG]: false }));
  }
  return out;
}
