// Pure helpers shared by the server (one-shot + SSE) and the browser build-log viewer.
import { stripAnsi } from "../../evidence/lines";
import { detectLogLevel } from "./log-level";
import type { LogLevel } from "./types";

/**
 * One Liara build-output entry -> display lines. Build tools colour their output (npm errors arrive on STDOUT as
 * "\u001b[91mnpm error ...\u001b[0m") and one entry may hold several lines. Strips ANSI, splits on newlines and
 * drops trailing blank lines; an empty entry stays one blank line.
 */
export function splitBuildLine(entry: string): string[] {
  const parts = stripAnsi(entry).replace(/\r/g, "").split("\n");
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Level shown in the build viewer: only errors and warnings are highlighted (npm error, ERR!, Error: ...), whatever the stream. */
export function buildLineLevel(text: string): Extract<LogLevel, "error" | "warn"> | undefined {
  const lv = detectLogLevel(text);
  return lv === "error" || lv === "warn" ? lv : undefined;
}
