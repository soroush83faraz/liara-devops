import { tailRuntimeLogs, type LogLine } from "@/lib/liara";
import { api } from "@/lib/server/liara";
import { fa } from "@/lib/i18n/fa";
import { logTailCap } from "@/lib/service/app-read/concurrency";
import { logRedactorFor } from "@/lib/service/app-read/known-secrets";
import { toLogLineDto, toLogLineDtos } from "@/lib/service/app-read/mappers";
import { isValidReleaseId, parseSinceSec } from "@/lib/service/app-read/params";
import { appNameFrom, badName } from "@/lib/service/app-read/route-helpers";
import { sseResponse } from "@/lib/service/app-read/sse";
import type { LogStreamEvent } from "@/lib/service/app-read/types";

type Ctx = { params: Promise<{ name: string }> };

const MAX_DURATION_MS = 15 * 60_000;
const BACKFILL_SEC = 300;

/**
 * SSE tail of runtime logs (server polls Liara every ~1.5 s). Default `message` events: `{kind:'open'|'line'|'end'|'error'}`.
 * Max 3 concurrent tails per account (extra ones get a fatal error event), 15 min per connection
 * (an `end` event follows; the client reconnects with `since`).
 */
export const GET = api(async ({ liara, session, request }, { params }: Ctx) => {
  const r = await appNameFrom(params);
  if ("error" in r) return r.error;
  const sp = new URL(request.url).searchParams;
  const releaseId = sp.get("releaseId") || undefined;
  if (releaseId && !isValidReleaseId(releaseId)) return badName();
  const sinceSec = parseSinceSec(sp.get("since")) ?? Math.floor(Date.now() / 1000) - BACKFILL_SEC;

  const release = logTailCap().acquire(session.accountId);
  if (!release) {
    return sseResponse({
      signal: request.signal,
      maxDurationMs: 5000,
      run: async ({ send }) => {
        const ev: LogStreamEvent = { kind: "error", code: "too_many_streams", message: fa.appOps.conn.tailCap, fatal: true };
        send(ev);
      },
    });
  }
  return sseResponse({
    signal: request.signal,
    heartbeatMs: 15_000,
    maxDurationMs: MAX_DURATION_MS,
    endEvent: { kind: "end", reason: "max_duration" } satisfies LogStreamEvent,
    onClose: release,
    run: async ({ send, signal }) => {
      send({ kind: "open", sinceSec } satisfies LogStreamEvent);
      let previous: LogLine | undefined;
      for await (const line of tailRuntimeLogs(liara, r.name, { sinceSec, releaseId, signal })) {
        // The app's env values are known secrets (cached briefly per account, refreshed after the TTL). Masking
        // with the previous line as context catches the second half of a secret split over two lines.
        const redactor = await logRedactorFor(liara, session, r.name);
        const dto = previous ? toLogLineDtos([previous, line], redactor)[1] : toLogLineDto(line, { redactor });
        previous = line;
        if (!send({ kind: "line", line: dto } satisfies LogStreamEvent)) return;
      }
    },
  });
});
