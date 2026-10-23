// Collapsed "technical request" in the approval dialog: method + path + masked body. It is a summary of what the
// server sends to Liara (illustrative: paths follow the documented API in docs/liara-api.md, some shapes are [VAL]).
// Values are always masked and never read from anywhere: bodies are built from keys and public parameters only.
import type { ActionParams, EnvChange } from "@/lib/contracts";
import { MASK } from "./diff";

export interface TechRequest {
  method: "POST" | "GET" | "PUT" | "DELETE";
  path: string;
  /** Pretty JSON, values masked; undefined for body-less calls. */
  body?: string;
  /** English technical note shown below the code (LTR). */
  note?: string;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function envBody(project: string, setKeys: string[], unsetKeys: string[]): TechRequest {
  const variables = setKeys.map((key) => ({ key, value: MASK }));
  return {
    method: "POST",
    path: "/v1/projects/update-envs",
    body: pretty({ project, variables }),
    note: `full-list merge on the server (existing variables kept${unsetKeys.length > 0 ? `; removed: ${unsetKeys.join(", ")}` : ""}), then read-back`,
  };
}

const setKeysOf = (changes: readonly EnvChange[]) => changes.filter((c) => c.op === "set").map((c) => c.key);
const unsetKeysOf = (changes: readonly EnvChange[]) => changes.filter((c) => c.op === "unset").map((c) => c.key);

export function buildTechnicalRequests(params: ActionParams): TechRequest[] {
  switch (params.type) {
    case "restart":
      return [{ method: "POST", path: `/v1/projects/${params.app}/actions/restart` }];
    case "set_env":
      return [envBody(params.app, setKeysOf(params.changes), unsetKeysOf(params.changes))];
    case "unset_env":
      return [envBody(params.app, [], params.keys)];
    case "scale":
      return [
        {
          method: "POST",
          path: params.resource.kind === "app" ? `/v1/projects/${params.resource.name}/actions/scale` : `/v1/databases/{id}/actions/scale`,
          body: pretty({ scale: params.scale }),
          note: params.resource.kind === "db" ? `{id} = Liara id of ${params.resource.name}` : undefined,
        },
      ];
    case "update_port":
      return [{ method: "POST", path: "/v1/projects/update-port", body: pretty({ project: params.app, port: params.port }) }];
    case "resize":
      return [
        {
          method: "POST",
          path: params.resource.kind === "app" ? `/v1/projects/${params.resource.name}/resize` : `/v1/databases/{id}/resize`,
          body: pretty({ planID: params.planId, ...(params.bundlePlanId ? { bundlePlanID: params.bundlePlanId } : {}) }),
        },
      ];
    case "redeploy_previous":
      return [
        {
          method: "POST",
          path: `/v2/projects/${params.app}/releases`,
          body: pretty({ releaseId: params.releaseId }),
          note: "redeploys the image/source of that release (there is no rollback endpoint)",
        },
      ];
    case "wire_db":
      return [envBody(params.app, Object.values(params.mapping).filter((k): k is string => typeof k === "string"), [])];
    case "deploy_plan":
      return params.plan.steps.flatMap((s): TechRequest[] => {
        switch (s.kind) {
          case "create_app":
            return [{ method: "POST", path: "/v1/projects", body: pretty({ name: s.name, planID: s.planId, platform: s.platform, ...(s.network ? { network: s.network } : {}) }) }];
          case "create_db":
            return [
              {
                method: "POST",
                path: "/v1/databases",
                body: pretty({ hostname: s.name, type: s.engine, version: s.version, planID: s.planId, publicNetwork: s.publicNetwork, ...(s.network ? { network: s.network } : {}) }),
              },
            ];
          case "set_env":
            return [envBody(s.app, setKeysOf(s.changes), unsetKeysOf(s.changes))];
          case "wire_db":
            return [envBody(s.app, Object.values(s.mapping).filter((k): k is string => typeof k === "string"), [])];
          case "deploy":
            return [
              {
                method: "POST",
                path: `/v2/projects/${s.app}/releases`,
                body: pretty(s.source.kind === "image" ? { image: s.source.image, port: s.port, type: "docker" } : { sourceID: "<uploaded source>", port: s.port }),
              },
            ];
          case "domain_guidance":
            return [];
        }
      });
    default:
      return [];
  }
}
