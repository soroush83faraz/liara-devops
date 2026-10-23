"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appPath } from "@/lib/service/app-read/client";
import { capTail, lineKey, LOG_CAP } from "@/lib/service/app-read/log-text";
import type { LogLineDto, LogStreamEvent } from "@/lib/service/app-read/types";
import { useEventStream, type StreamState } from "@/lib/service/app-read/use-event-stream";

const FLUSH_MS = 250;
const SEEN_MAX = 5000;

export interface LogStream {
  lines: LogLineDto[];
  /** Lines dropped from the front because of the cap. */
  dropped: number;
  /** Lines received while paused. */
  pending: number;
  state: StreamState;
  /** Set when the server refuses to continue (e.g. the 3-tail cap); no auto-reconnect happens. */
  fatal: string | null;
  retry: () => void;
  clear: () => void;
}

/**
 * Live runtime-log tail over SSE. Batches DOM updates every 250 ms, de-duplicates lines across reconnects
 * (`tsNs|stream|message`), keeps the newest LOG_CAP lines. While `paused`, lines accumulate off-screen.
 */
export function useLogStream(opts: { name: string; releaseId?: string; sinceIso?: string; paused: boolean }): LogStream {
  const { name, releaseId, sinceIso, paused } = opts;
  const [lines, setLines] = useState<LogLineDto[]>([]);
  const [dropped, setDropped] = useState(0);
  const [pending, setPending] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);

  const pendingRef = useRef<LogLineDto[]>([]);
  const linesRef = useRef<LogLineDto[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const seenOrderRef = useRef<string[]>([]);
  const lastSecRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const buildUrl = useCallback(() => {
    const q = new URLSearchParams();
    if (releaseId) q.set("releaseId", releaseId);
    if (lastSecRef.current !== null) q.set("since", String(lastSecRef.current));
    else if (sinceIso) q.set("since", sinceIso);
    const qs = q.toString();
    return `${appPath(name, "logs/stream")}${qs ? `?${qs}` : ""}`;
  }, [name, releaseId, sinceIso]);

  const onEvent = useCallback((ev: LogStreamEvent) => {
    if (ev.kind === "line") {
      const key = lineKey(ev.line);
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      seenOrderRef.current.push(key);
      if (seenOrderRef.current.length > SEEN_MAX) {
        const drop = seenOrderRef.current.splice(0, seenOrderRef.current.length - SEEN_MAX);
        for (const k of drop) seenRef.current.delete(k);
      }
      pendingRef.current.push(ev.line);
      if (ev.line.tsNs !== "0") {
        const sec = Math.floor(Number(BigInt(ev.line.tsNs) / BigInt(1_000_000_000)));
        if (lastSecRef.current === null || sec > lastSecRef.current) lastSecRef.current = sec;
      }
      return;
    }
    if (ev.kind === "end") return "reconnect";
    if (ev.kind === "error" && ev.fatal) {
      setFatal(ev.message);
      return "stop";
    }
  }, []);

  const { state, retry: retryStream } = useEventStream<LogStreamEvent>({ buildUrl, onEvent });

  useEffect(() => {
    const id = setInterval(() => {
      const batch = pendingRef.current;
      if (pausedRef.current) {
        setPending((p) => (p === batch.length ? p : batch.length));
        return;
      }
      if (!batch.length) return;
      pendingRef.current = [];
      setPending(0);
      const next = capTail([...linesRef.current, ...batch], LOG_CAP);
      linesRef.current = next.items;
      setLines(next.items);
      if (next.dropped) setDropped((d) => d + next.dropped);
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  const clear = useCallback(() => {
    pendingRef.current = [];
    linesRef.current = [];
    setPending(0);
    setDropped(0);
    setLines([]);
  }, []);

  const retry = useCallback(() => {
    setFatal(null);
    retryStream();
  }, [retryStream]);

  return { lines, dropped, pending, state, fatal, retry, clear };
}
