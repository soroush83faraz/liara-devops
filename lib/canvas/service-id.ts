// Panel ids: other units receive `service` from the shell store / URL and need to know the kind.
import type { ServiceKind } from "./types";

export const DB_ID_PREFIX = "db:";

export const appServiceId = (name: string): string => name;
export const dbServiceId = (hostname: string): string => `${DB_ID_PREFIX}${hostname}`;

/** `db:<hostname>` -> database; anything else is an app name. */
export function parseServiceId(id: string): { kind: ServiceKind; name: string } {
  return id.startsWith(DB_ID_PREFIX) ? { kind: "db", name: id.slice(DB_ID_PREFIX.length) } : { kind: "app", name: id };
}
