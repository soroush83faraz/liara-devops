import {
  AnyBodySchema,
  CreatedDomainResponseSchema,
  DomainCheckResponseSchema,
  DomainsResponseSchema,
  ProvisionSslResponseSchema,
  type Domain,
} from "./schemas";
import type { LiaraClient } from "./core";
import { seg } from "./util";

/** [V] GET /v1/domains?project= */
export async function listDomains(client: LiaraClient, app: string): Promise<Domain[]> {
  return (await client.get("/v1/domains", DomainsResponseSchema, { query: { project: app } })).domains;
}

/** [V] POST /v1/domains {name, project, type:"PROJECT"} -> {domain:{_id}}. Record values come from `checkDomain`. */
export async function addDomain(client: LiaraClient, app: string, name: string): Promise<string | undefined> {
  const res = await client.post("/v1/domains", CreatedDomainResponseSchema, { json: { name, project: app, type: "PROJECT" } });
  return res.domain._id;
}

/** [V] GET /v1/domains/{id}/check: authoritative DNS/SSL state (`CNameRecord`, `verificationCode`, `certificatesStatus`). */
export async function checkDomain(client: LiaraClient, domainId: string): Promise<Domain> {
  return (await client.get(`/v1/domains/${seg(domainId)}/check`, DomainCheckResponseSchema)).domain;
}

/** [V] POST /v1/domains/provision-ssl-certs {domain}. Spec says "domain": name vs id unverified [VAL]; the name is sent. */
export async function provisionSsl(client: LiaraClient, domainName: string): Promise<string | undefined> {
  return (await client.post("/v1/domains/provision-ssl-certs", ProvisionSslResponseSchema, { json: { domain: domainName } })).code;
}

/** [V] POST /v1/domains/{id}/set-redirect {redirectStatus, redirectTo} */
export async function setDomainRedirect(client: LiaraClient, domainId: string, redirectTo: string, redirectStatus = 301): Promise<void> {
  await client.post(`/v1/domains/${seg(domainId)}/set-redirect`, AnyBodySchema, { json: { redirectStatus, redirectTo } });
}

/** [V] POST /v1/domains/{id}/ssl/disable (204) */
export async function disableSsl(client: LiaraClient, domainId: string): Promise<void> {
  await client.post(`/v1/domains/${seg(domainId)}/ssl/disable`, AnyBodySchema);
}

/** [V] DELETE /v1/domains/{id} */
export async function removeDomain(client: LiaraClient, domainId: string): Promise<void> {
  await client.delete(`/v1/domains/${seg(domainId)}`, AnyBodySchema);
}
