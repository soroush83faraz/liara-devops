// Defense in depth: the agent pipeline only ever receives this wrapper, which refuses every non-GET
// request at the transport level. Even a bug that called a mutating lib/liara function would fail here.
import { LiaraError, type HttpMethod, type LiaraClient, type RequestOptions } from "@/lib/liara";
import type { z } from "zod";

export class ReadOnlyViolation extends LiaraError {
  constructor(method: string) {
    super({ status: 0, kind: "forbidden", code: "agent_read_only", message: `agent client is read-only (${method})` });
    this.name = "ReadOnlyViolation";
  }
}

export function readOnlyLiara(client: LiaraClient): LiaraClient {
  const deny = (method: string) => Promise.reject(new ReadOnlyViolation(method));
  return Object.freeze({
    baseUrl: client.baseUrl,
    teamId: client.teamId,
    request<T>(method: HttpMethod, path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> {
      return method === "GET" ? client.request(method, path, schema, opts) : deny(method);
    },
    get<T>(path: string, schema: z.ZodType<T>, opts?: RequestOptions): Promise<T> {
      return client.get(path, schema, opts);
    },
    post: () => deny("POST"),
    patch: () => deny("PATCH"),
    delete: () => deny("DELETE"),
  }) as LiaraClient;
}
