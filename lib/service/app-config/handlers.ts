// Route logic for the app configuration tabs. Each `handle…` function takes the `ApiContext` that `api()`
// builds (session + Liara client + request) and returns a Response; the files under app/api only wire them up.
// Rules: env values leave only through `handleRevealEnv`; every mutation goes through `runUserOp`
// (rate limit, typed name, audit); thrown LiaraErrors are mapped by the `api()` wrapper.
import type { z } from "zod";
import {
  addDomain,
  checkDomain,
  createDisk,
  disableSsl,
  getApp,
  getEnvs,
  getMe,
  listAppPlans,
  listDisks,
  listDomains,
  listReleases,
  LiaraError,
  provisionSsl,
  resizeDisk,
  setDomainRedirect,
  setAppToggle,
} from "@/lib/liara";
import { DiskNameSchema } from "@/lib/contracts/common";
import { t } from "@/lib/i18n/t";
import { PolicyError, rateLimit } from "@/lib/security";
import { readJsonCapped } from "@/lib/server/body";
import { errorResponse, type ApiContext } from "@/lib/server/liara";
import { runUserOp } from "@/lib/server/user-op";
import { isValidAppName } from "@/lib/service/app-read/params";
import type { DomainAddedDto, DomainCheckDto, DomainsListDto, EnvListDto, SettingsDto } from "./dto";
import { domainTargetName, normalizeDomainInput, validateRedirectTarget } from "./domain-doctor";
import { toDisksDto, toDomainDto, toMaskedEnvList, toPlanOptions, toSettingsDto } from "./mappers";
import {
  AddDomainBody,
  CreateDiskBody,
  RedirectBody,
  ResizeDiskBody,
  RevealBody,
  SAFE_ID,
  SslBody,
  ToggleBody,
} from "./schemas";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

const bad = (code: string, message = t("errors.badRequest")) => errorResponse(400, code, message);

export type NameParams = { name: string };
export type IdParams = { id: string };
export type DiskParams = { name: string; disk: string };

function appName(p: NameParams): string | Response {
  return isValidAppName(p.name) ? p.name : bad("bad_name");
}
function domainId(p: IdParams): string | Response {
  return SAFE_ID.test(p.id) ? p.id : bad("bad_id");
}

/** Largest config body (a 2048-char redirect URL, even fully \u-escaped) fits; more is a 413 before buffering. */
const MAX_CONFIG_BODY_BYTES = 16 * 1024;

async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | Response> {
  const body = await readJsonCapped(request, MAX_CONFIG_BODY_BYTES);
  if (!body.ok) return body.reason === "too_large" ? errorResponse(413, "payload_too_large", t("errors.badRequest")) : bad("bad_json");
  if (body.empty) return bad("bad_json");
  const parsed = schema.safeParse(body.value);
  return parsed.success ? parsed.data : bad("bad_body");
}

/** 429 response when the per-account bucket is exhausted, else null. */
function limited(ctx: ApiContext, bucket: string, limit: number, windowMs: number): Response | null {
  const r = rateLimit(`${bucket}:${ctx.session.accountId}`, limit, windowMs);
  if (r.ok) return null;
  return errorResponse(429, "rate_limited", t("errors.rateLimited"), { retryAfterSec: Math.ceil(r.retryAfterMs / 1000) });
}

/* ------------------------------------------------------------------ envs */

/** Masked list: key, encrypted flag and value length only. */
export async function handleListEnvs(ctx: ApiContext, p: NameParams): Promise<Response> {
  const name = appName(p);
  if (typeof name !== "string") return name;
  const envs = await getEnvs(ctx.liara, name);
  const body: EnvListDto = { envs: toMaskedEnvList(envs) };
  return json(body);
}

/** The only route that returns a value: one key, rate-limited (10/min), audited as `env.reveal` (key never value). */
export async function handleRevealEnv(ctx: ApiContext, p: NameParams): Promise<Response> {
  const name = appName(p);
  if (typeof name !== "string") return name;
  const body = await readBody(ctx.request, RevealBody);
  if (body instanceof Response) return body;
  // Existing variables may predate our key rule, so only reject what cannot be a key at all.
  if (/[\s=\u0000-\u001f]/.test(body.key)) return bad("bad_key");
  const key = body.key;
  return runUserOp({
    ctx,
    action: "env.reveal",
    target: { kind: "app", name },
    params: { key },
    run: async () => {
      const r = rateLimit(`env.reveal:${ctx.session.accountId}`, 10, 60_000);
      if (!r.ok) throw new PolicyError("rate_limited", "rate limit exceeded", { retryAfterMs: r.retryAfterMs });
      const found = (await getEnvs(ctx.liara, name)).find((e) => e.key === key);
      if (!found) throw new LiaraError({ status: 404, kind: "not_found", message: "env key not found" });
      return { value: found.value };
    },
  });
}

/* --------------------------------------------------------------- domains */

export async function handleListDomains(ctx: ApiContext, p: NameParams): Promise<Response> {
  const name = appName(p);
  if (typeof name !== "string") return name;
  const body: DomainsListDto = { domains: (await listDomains(ctx.liara, name)).map(toDomainDto) };
  return json(body);
}

const DOMAIN_PROBLEM_KEY = {
  empty: "appConfig.domains.input.empty",
  invalid: "appConfig.domains.input.invalid",
  wildcard: "appConfig.domains.input.wildcard",
  restricted_tld: "appConfig.domains.input.restricted",
  too_long: "appConfig.domains.input.invalid",
} as const;

export async function handleAddDomain(ctx: ApiContext, p: NameParams): Promise<Response> {
  const app = appName(p);
  if (typeof app !== "string") return app;
  const body = await readBody(ctx.request, AddDomainBody);
  if (body instanceof Response) return body;
  const norm = normalizeDomainInput(body.name);
  if (!norm.ok) return bad("invalid_domain", t(DOMAIN_PROBLEM_KEY[norm.reason], { tld: norm.tld ?? "" }));
  const name = norm.name;
  return runUserOp({
    ctx,
    action: "domain.add",
    target: { kind: "domain", name },
    params: { app, name },
    run: async (): Promise<Record<string, unknown>> => {
      const id = await addDomain(ctx.liara, app, name);
      let domain: DomainAddedDto["domain"];
      if (id) {
        try {
          domain = toDomainDto(await checkDomain(ctx.liara, id));
          if (!domain.id) domain.id = id;
        } catch {
          domain = undefined; // the records can be fetched later with «check»
        }
      }
      return { id, domain };
    },
  });
}

/** `GET /v1/domains/{id}/check` is authoritative; the UI only claims DNS is configured from this response. */
export async function handleCheckDomain(ctx: ApiContext, p: IdParams): Promise<Response> {
  const id = domainId(p);
  if (typeof id !== "string") return id;
  const tooMany = limited(ctx, "domain.check", 20, 60_000);
  if (tooMany) return tooMany;
  const d = toDomainDto(await checkDomain(ctx.liara, id));
  if (!d.id) d.id = id;
  const body: DomainCheckDto = { checkedAt: new Date().toISOString(), domain: d };
  return json(body);
}

export async function handleDomainSsl(ctx: ApiContext, p: IdParams): Promise<Response> {
  const id = domainId(p);
  if (typeof id !== "string") return id;
  const body = await readBody(ctx.request, SslBody);
  if (body instanceof Response) return body;
  const domain = await checkDomain(ctx.liara, id);
  const name = domain.name;
  if (!name) return errorResponse(502, "liara_bad_response", t("errors.liaraBadResponse"));
  const target = { kind: "domain" as const, name: domainTargetName(name) };
  if (body.enable) {
    return runUserOp({
      ctx,
      action: "ssl.provision",
      target,
      params: { id, enable: true },
      run: async () => {
        await provisionSsl(ctx.liara, name);
        return { requested: true };
      },
    });
  }
  // Turning SSL off exposes traffic in clear text: typed name required.
  return runUserOp({
    ctx,
    action: "ssl.disable",
    target,
    params: { id, enable: false },
    requireTypedName: true,
    typedName: body.typedName,
    run: async () => {
      await disableSsl(ctx.liara, id);
      return { disabled: true };
    },
  });
}

export async function handleDomainRedirect(ctx: ApiContext, p: IdParams): Promise<Response> {
  const id = domainId(p);
  if (typeof id !== "string") return id;
  const body = await readBody(ctx.request, RedirectBody);
  if (body instanceof Response) return body;
  const domain = await checkDomain(ctx.liara, id);
  const name = domain.name;
  if (!name) return errorResponse(502, "liara_bad_response", t("errors.liaraBadResponse"));
  const target = validateRedirectTarget(body.redirectTo, name);
  if (!target.ok) return bad("invalid_redirect", t("appConfig.domains.redirect.invalid"));
  return runUserOp({
    ctx,
    action: "domain.redirect",
    target: { kind: "domain", name: domainTargetName(name) },
    params: { id, redirectTo: target.value, redirectStatus: body.redirectStatus },
    run: async () => {
      await setDomainRedirect(ctx.liara, id, target.value, body.redirectStatus);
      return { redirectStatus: body.redirectStatus };
    },
  });
}

/* ----------------------------------------------------------------- disks */

export async function handleListDisks(ctx: ApiContext, p: NameParams): Promise<Response> {
  const name = appName(p);
  if (typeof name !== "string") return name;
  const [res, app] = await Promise.all([
    listDisks(ctx.liara, name),
    getApp(ctx.liara, name).catch(() => undefined),
  ]);
  return json(toDisksDto(res, app?.reservedDiskSpace));
}

/** Billed: typed disk name required. */
export async function handleCreateDisk(ctx: ApiContext, p: NameParams): Promise<Response> {
  const app = appName(p);
  if (typeof app !== "string") return app;
  const body = await readBody(ctx.request, CreateDiskBody);
  if (body instanceof Response) return body;
  return runUserOp({
    ctx,
    action: "disk.create",
    target: { kind: "disk", name: body.name },
    params: { app, name: body.name, sizeGb: body.sizeGb },
    requireTypedName: true,
    typedName: body.typedName,
    run: async () => {
      await createDisk(ctx.liara, app, body.name, body.sizeGb);
      return { sizeGb: body.sizeGb };
    },
  });
}

/** Tier 2: grow only (shrinking may destroy data and is unverified on Liara [VAL]); typed disk name required. */
export async function handleResizeDisk(ctx: ApiContext, p: DiskParams): Promise<Response> {
  const app = appName(p);
  if (typeof app !== "string") return app;
  if (!DiskNameSchema.safeParse(p.disk).success) return bad("bad_name");
  const body = await readBody(ctx.request, ResizeDiskBody);
  if (body instanceof Response) return body;
  const current = (await listDisks(ctx.liara, app)).disks.find((d) => d.name === p.disk);
  if (!current) return errorResponse(404, "not_found", t("errors.notFound"));
  if (typeof current.size === "number" && body.sizeGb <= current.size) {
    return bad("not_larger", t("appConfig.disks.resize.notLarger"));
  }
  return runUserOp({
    ctx,
    action: "disk.resize",
    target: { kind: "disk", name: p.disk },
    params: { app, disk: p.disk, from: current.size ?? null, to: body.sizeGb },
    requireTypedName: true,
    typedName: body.typedName,
    run: async () => {
      await resizeDisk(ctx.liara, app, p.disk, body.sizeGb);
      return { sizeGb: body.sizeGb };
    },
  });
}

/* -------------------------------------------------------------- settings */

export async function handleGetSettings(ctx: ApiContext, p: NameParams): Promise<Response> {
  const name = appName(p);
  if (typeof name !== "string") return name;
  const [app, me, releases] = await Promise.all([
    getApp(ctx.liara, name),
    getMe(ctx.liara).catch(() => undefined),
    listReleases(ctx.liara, name, { page: 1, count: 1 }).catch(() => undefined),
  ]);

  let plans: SettingsDto["plans"] = { unavailable: true };
  if (me) {
    const options = toPlanOptions(listAppPlans(me));
    if (app.planID && !options.some((o) => o.id === app.planID)) {
      const current = listAppPlans(me, { availableOnly: false, includeLegacy: true, region: "any" }).find((x) => x.id === app.planID);
      if (current) options.push(...toPlanOptions([current]).map((o) => ({ ...o, available: false })));
    }
    plans = { unavailable: false, data: options };
  }
  return json(toSettingsDto(app, name, { port: releases?.releases[0]?.port, plans }));
}

/** Fixed IP changes the app's address (and is a paid feature): typed app name. Other toggles: one confirm in the UI. */
export async function handleToggle(ctx: ApiContext, p: NameParams): Promise<Response> {
  const name = appName(p);
  if (typeof name !== "string") return name;
  const body = await readBody(ctx.request, ToggleBody);
  if (body instanceof Response) return body;
  return runUserOp({
    ctx,
    action: `toggle.${body.toggle}`,
    target: { kind: "app", name },
    params: { toggle: body.toggle, enabled: body.enabled },
    requireTypedName: body.toggle === "fixed-ip",
    typedName: body.typedName,
    run: async () => {
      const res = await setAppToggle(ctx.liara, name, body.toggle, body.enabled);
      return { enabled: body.enabled, ...(res.IP ? { ip: res.IP } : {}) };
    },
  });
}
