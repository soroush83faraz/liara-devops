"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type StreamState = "connecting" | "live" | "reconnecting" | "ended" | "failed";

export type HandlerResult = "stop" | "reconnect" | void;

export interface EventStreamOptions<T> {
  /** Called on every (re)connect; return null to stay disconnected. Lets callers resume with `since=`. */
  buildUrl: () => string | null;
  /** Return "stop" to end for good, "reconnect" to reopen immediately (e.g. server max duration). */
  onEvent: (event: T) => HandlerResult;
  /** Consecutive failures before giving up (default 6). */
  maxFailures?: number;
}

export const backoffMs = (failures: number): number => Math.min(15_000, 1000 * 2 ** Math.max(0, failures - 1));

/**
 * EventSource with manual reconnect (exponential backoff) and a visible connection state.
 * Mount/unmount (or change `key` on the parent) to start/stop; closes the connection on unmount.
 * setState only runs in callbacks/timers, never synchronously in the effect.
 */
export function useEventStream<T>(opts: EventStreamOptions<T>): { state: StreamState; retry: () => void } {
  const [state, setState] = useState<StreamState>("connecting");
  const [nonce, setNonce] = useState(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const url = optsRef.current.buildUrl();
      if (!url) return;
      es = new EventSource(url);
      es.onopen = () => {
        failures = 0;
        setState("live");
      };
      es.onmessage = (e: MessageEvent<string>) => {
        let parsed: T;
        try {
          parsed = JSON.parse(e.data) as T;
        } catch {
          return;
        }
        const result = optsRef.current.onEvent(parsed);
        if (result === "stop") {
          es?.close();
          setState("ended");
        } else if (result === "reconnect") {
          es?.close();
          timer = setTimeout(connect, 250);
        }
      };
      es.onerror = () => {
        es?.close();
        failures += 1;
        if (failures > (optsRef.current.maxFailures ?? 6)) return setState("failed");
        setState("reconnecting");
        timer = setTimeout(connect, backoffMs(failures));
      };
    };

    connect();
    return () => {
      disposed = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [nonce]);

  const retry = useCallback(() => {
    setState("connecting");
    setNonce((n) => n + 1);
  }, []);

  return { state, retry };
}
