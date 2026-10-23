import { api } from "@/lib/server/liara";
import { appParam, buildLogRedactor } from "@/lib/service/app-read/build-logs";
import { badName, releaseIdFrom } from "@/lib/service/app-read/route-helpers";
import { streamRelease } from "@/lib/service/app-read/release-stream";
import { sseResponse } from "@/lib/service/app-read/sse";

type Ctx = { params: Promise<{ id: string }> };

const MAX_DURATION_MS = 30 * 60_000;

/**
 * SSE of a release's progress: `{kind:'state'|'log'|'done'|'error'}` as default `message` events,
 * `: hb` comments every 15 s. Ends on a terminal state, client disconnect or after 30 minutes.
 * `?app=<name>` (sent by the UI) adds the app's env values as known secrets; without it only pattern rules apply.
 */
export const GET = api(async ({ liara, session, request }, { params }: Ctx) => {
  const r = await releaseIdFrom(params);
  if ("error" in r) return r.error;
  const a = appParam(new URL(request.url).searchParams);
  if (a.invalid) return badName();
  const redactor = await buildLogRedactor(liara, session, a.app);
  return sseResponse({
    signal: request.signal,
    heartbeatMs: 15_000,
    maxDurationMs: MAX_DURATION_MS,
    endEvent: { kind: "done", state: "TIMEDOUT", ok: false, reason: "watch_timeout" },
    run: async ({ send, signal }) => {
      for await (const ev of streamRelease(liara, r.id, { signal, timeoutMs: MAX_DURATION_MS, redactor })) {
        if (!send(ev)) return;
        if (ev.kind === "done") return;
      }
    },
  });
});
