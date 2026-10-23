// Parsing of the POST /api/probe body. Only a service id is accepted: any `url` / `host` field is ignored.
import { parseServiceId } from "./service-id";

const NAME_RE = /^[\w.-]{1,128}$/;

export function parseProbeBody(body: unknown): { name: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const service = (body as Record<string, unknown>).service;
  if (typeof service !== "string") return null;
  const { kind, name } = parseServiceId(service);
  return kind === "app" && NAME_RE.test(name) ? { name } : null;
}
