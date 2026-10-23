import { describe, expect, it } from "vitest";
import type { ActionParams } from "@/lib/contracts";
import { fixtureDeployPlanParams, fixtureResizeParams, fixtureSetEnvParams } from "@/lib/contracts/fixtures";
import { buildDiff, MASK } from "@/lib/copilot/diff";
import { buildTechnicalRequests } from "@/lib/copilot/technical-request";

const SENTINEL = "SUPER-SECRET-VALUE-123";

/** A hostile caller that smuggles a literal value into every env change (the contracts forbid it; the UI must not read it). */
function smuggled(params: ActionParams): ActionParams {
  const clone = JSON.parse(JSON.stringify(params)) as ActionParams;
  const visit = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(visit);
    else if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      if (o.op === "set") {
        o.value = SENTINEL;
        o.literal = SENTINEL;
      }
      Object.values(o).forEach(visit);
    }
  };
  visit(clone);
  return clone;
}

describe("diff builder", () => {
  it("shows generated secrets as a masked source, never a value", () => {
    const lines = buildDiff(fixtureSetEnvParams);
    expect(lines).toEqual([{ sign: "+", code: "SESSION_SECRET", value: { kind: "generated" } }]);
  });

  it("marks user-typed values by source only", () => {
    const lines = buildDiff({ type: "set_env", app: "a", changes: [{ op: "set", key: "SMTP_PASSWORD", valueSource: "user" }] });
    expect(lines[0]).toEqual({ sign: "+", code: "SMTP_PASSWORD", value: { kind: "user" } });
  });

  it("shows existing/db sources by name, unset as a minus line", () => {
    const lines = buildDiff({
      type: "set_env",
      app: "a",
      changes: [
        { op: "set", key: "DB_PASSWORD", valueSource: "existing", from: { kind: "db", name: "shop-db", field: "password" } },
        { op: "set", key: "SECRET", valueSource: "existing", from: { kind: "app_env", key: "SESION_SECRET" } },
        { op: "unset", key: "OLD" },
      ],
    });
    expect(lines[0].value).toEqual({ kind: "db", db: "shop-db", field: "password" });
    expect(lines[1].value).toEqual({ kind: "existing", from: "SESION_SECRET" });
    expect(lines[2]).toEqual({ sign: "-", code: "OLD" });
  });

  it("never contains a value, even if the params object carries one", () => {
    for (const params of [fixtureSetEnvParams, fixtureDeployPlanParams]) {
      const dirty = smuggled(params);
      expect(JSON.stringify(dirty)).toContain(SENTINEL); // the trap is armed
      expect(JSON.stringify(buildDiff(dirty))).not.toContain(SENTINEL);
      expect(JSON.stringify(buildTechnicalRequests(dirty))).not.toContain(SENTINEL);
    }
  });

  it("describes non-env actions as labelled lines", () => {
    expect(buildDiff({ type: "restart", app: "shop" })[0].label).toEqual({ key: "restart", params: { name: "shop" } });
    expect(buildDiff({ type: "scale", resource: { kind: "db", name: "d" }, scale: 0 })[0].label?.key).toBe("scaleOff");
    expect(buildDiff({ type: "update_port", app: "shop", port: 8080 })[0].label?.params).toEqual({ name: "shop", port: 8080 });
    expect(buildDiff(fixtureResizeParams)[0].label).toEqual({ key: "plan", params: { name: "broken-shop", plan: "standard-g2" } });
    const wire = buildDiff({ type: "wire_db", app: "a", db: "d", mapping: { url: "DATABASE_URL", password: "DB_PASS" } });
    expect(wire[0].label?.key).toBe("wire");
    expect(wire.slice(1).map((l) => l.code)).toEqual(["DATABASE_URL", "DB_PASS"]);
    expect(wire.slice(1).every((l) => l.value?.kind === "db")).toBe(true);
  });

  it("flattens a deploy plan step by step", () => {
    const lines = buildDiff(fixtureDeployPlanParams);
    expect(lines.map((l) => l.step)).toEqual(expect.arrayContaining(["S1", "S2", "S3", "S4", "S5", "S6"]));
    expect(lines.some((l) => l.code === "SMTP_PASSWORD" && l.value?.kind === "user")).toBe(true);
  });
});

describe("technical request", () => {
  it("masks every env value and reports method + path", () => {
    const [req] = buildTechnicalRequests(fixtureSetEnvParams);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/projects/update-envs");
    expect(req.body).toContain(MASK);
    expect(JSON.parse(req.body!)).toEqual({ project: "broken-shop", variables: [{ key: "SESSION_SECRET", value: MASK }] });
  });
  it("covers restart / port / resize / deploy plan", () => {
    expect(buildTechnicalRequests({ type: "restart", app: "shop" })[0].path).toBe("/v1/projects/shop/actions/restart");
    expect(buildTechnicalRequests({ type: "update_port", app: "shop", port: 3000 })[0].body).toContain("3000");
    expect(buildTechnicalRequests(fixtureResizeParams)[0].path).toBe("/v1/projects/broken-shop/resize");
    expect(buildTechnicalRequests(fixtureDeployPlanParams).length).toBeGreaterThanOrEqual(5);
  });
});
