import { AnyBodySchema, NetworksResponseSchema, type Network } from "./schemas";
import { invalidArgument, type LiaraClient } from "./core";

/** [CLI] GET /v1/networks -> {networks:[{_id,name,createdAt}]} */
export async function listNetworks(client: LiaraClient): Promise<Network[]> {
  return (await client.get("/v1/networks", NetworksResponseSchema)).networks;
}

/** [CLI] POST /v1/networks {networkName}. 409 on duplicate. Network is immutable on services. */
export async function createNetwork(client: LiaraClient, networkName: string): Promise<void> {
  if (networkName.trim().length < 3) throw invalidArgument("network name must be at least 3 characters");
  await client.post("/v1/networks", AnyBodySchema, { json: { networkName } });
}
