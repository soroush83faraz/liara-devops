/** In-memory fake of the Liara endpoints the demo scripts use. Records every call; never touches the network. */
export interface FakeState {
  exists: boolean;
  envs: Array<{ key: string; value: string }>;
  releaseState: string;
  calls: string[];
  bodies: Array<{ call: string; body: unknown }>;
}

export function makeFake(init: Partial<FakeState> = {}) {
  const state: FakeState = { exists: true, envs: [], releaseState: "READY", calls: [], bodies: [], ...init };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const call = `${method} ${url.pathname}`;
    state.calls.push(call);
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    if (body !== undefined) state.bodies.push({ call, body });

    if (method === "GET" && url.pathname === "/v1/projects/broken-shop") {
      return state.exists
        ? json(200, { project: { project_id: "broken-shop", scale: 1, isDeployed: true, defaultSubdomain: true, envs: state.envs } })
        : json(404, { message: "not found" });
    }
    if (call === "POST /v1/projects/update-envs") {
      state.envs = (body as { variables: FakeState["envs"] }).variables;
      return json(200, { message: "ok" });
    }
    if (call === "POST /v1/projects") {
      state.exists = true;
      return json(200, {});
    }
    if (call === "GET /v1/me") {
      return json(200, {
        plans: {
          projects: { "iran-g2-small": { available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 5, price: 100 } },
          projectBundlePlans: { "iran-g2-small": { standard: { available: true, displayPrice: 5000 }, big: { available: true, displayPrice: 9000 } } },
        },
      });
    }
    if (call === "GET /v1/networks") return json(200, { networks: [{ _id: "net1", name: "main", createdAt: "2026-01-01T00:00:00Z" }] });
    if (call === "POST /v2/projects/broken-shop/sources") return json(200, { sourceID: "src1" });
    if (call === "POST /v2/projects/broken-shop/releases") return json(200, { releaseID: "rel1" });
    if (call === "GET /v1/releases/rel1") return json(200, { release: { _id: "rel1", state: state.releaseState, queue: 0 } });
    return json(404, { message: `unhandled ${call}` });
  };
  return { state, fetchImpl };
}

export function collectIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err, text: () => [...out, ...err].join("\n") };
}
