// Whether a log line is highlighted as «looks like instructions aimed at an AI assistant». The detector
// (`flagSuspiciousLines`, lib/security/injection) runs on the SERVER when the log DTO is built
// (lib/service/app-read/mappers.ts), so the browser only reads the flag. The text is always rendered as plain text.
import type { LogLineDto } from "@/lib/service/app-read/types";

export function isSuspiciousLine(line: Pick<LogLineDto, "flagged">): boolean {
  return line.flagged === true;
}
