import { z } from "zod";

/**
 * Lenient zod 4 schemas. Most Liara shapes are inferred from the CLI source or
 * the (partial) OpenAPI spec, so every scalar field is optional and a field of
 * the wrong type degrades to `undefined` instead of failing the whole response.
 * Objects are loose: unknown keys pass through. Enums are plain strings.
 */
const str = () => z.string().optional().catch(undefined);
const num = () => z.number().optional().catch(undefined);
const bool = () => z.boolean().optional().catch(undefined);
const anyRec = () => z.record(z.string(), z.unknown()).optional().catch(undefined);
const list = <T extends z.ZodType>(item: T) => z.array(item).catch([]);
/** Numbers that sometimes arrive as numeric strings (metrics samples). */
const numish = z.union([z.number(), z.string()]);

const obj = z.looseObject;

export const NetworkRefSchema = obj({ _id: str(), name: str() });

// ---- Apps ------------------------------------------------------------------
export const AppSummarySchema = obj({
  _id: str(),
  project_id: str(), // the app "name" used in URLs
  type: str(), // platform
  status: str(), // enum unknown [VAL]
  scale: num(),
  planID: str(),
  bundlePlanID: str(),
  created_at: str(),
  isDeployed: bool(),
  network: NetworkRefSchema.nullable().optional().catch(undefined),
});
export const AppsResponseSchema = obj({ projects: list(AppSummarySchema) });

export const EnvVarSchema = obj({
  key: z.string().catch(""),
  value: z.string().catch(""),
  encrypted: bool(),
  _id: str(),
});

export const AppDetailSchema = AppSummarySchema.extend({
  defaultSubdomain: bool(),
  readOnlyRootFilesystem: bool(),
  zeroDowntime: bool(),
  envs: list(EnvVarSchema),
  fixedIPStatus: str(),
  hourlyPrice: num(),
  bundleHourlyPrice: num(),
  node: obj({ _id: str(), IP: str() }).optional().catch(undefined),
  reservedDiskSpace: num(),
});
export const AppDetailResponseSchema = obj({ project: AppDetailSchema });

export const AppletSchema = obj({
  id: str(),
  name: str(),
  timestamp: str(),
  state: str(),
  reason: str(),
  release: obj({ releaseID: str(), tag: str() }).optional().catch(undefined),
});
export const AppletsResponseSchema = obj({ applets: list(AppletSchema) });

export const FixedIpResponseSchema = obj({ IP: str() });
export const UpdateEnvsResponseSchema = obj({ message: str() });

// ---- Releases ---------------------------------------------------------------
export const GitInfoSchema = obj({
  branch: str().nullable(),
  message: str().nullable(),
  commit: str().nullable(),
  committedAt: str().nullable(),
  remote: str().nullable(),
  author: obj({ email: str().nullable(), name: str().nullable() }).optional().catch(undefined),
  tags: z.array(z.string()).optional().catch(undefined),
});
export const ReleaseSchema = obj({
  _id: str(),
  type: str(),
  imageName: str(),
  projectType: str(),
  state: str(), // READY, FAILED, CANCELED, TIMEDOUT, DEPLOYING, UNHEALTHY, ... [CLI]
  status: str(),
  port: num(),
  gitInfo: GitInfoSchema.optional().catch(undefined),
  client: str(),
  createdAt: str(),
  finishedAt: str().nullable(),
  tag: str(),
  sourceAvailable: bool(),
  failReason: str(), // [CLI] types/release.ts
  queue: num(), // [CLI] builds ahead in queue
  buildLocation: str(),
});
export const ReleasesResponseSchema = obj({
  total: num(),
  currentRelease: str(),
  readyReleasesCount: num(),
  releases: list(ReleaseSchema),
  platform: str(),
});
export const ReleaseResponseSchema = obj({ release: ReleaseSchema });

export const BuildOutputLineSchema = obj({
  _id: str(),
  line: z.string().catch(""),
  stream: z.string().catch("STDOUT"), // STDOUT | STDERR [CLI]
  releaseID: str(),
  createdAt: str(),
});
export const BuildLogsResponseSchema = obj({
  release: ReleaseSchema.optional().catch(undefined),
  buildOutput: list(BuildOutputLineSchema),
});
export const CreatedReleaseSchema = obj({ releaseID: z.string() });
export const SourceUploadSchema = obj({ sourceID: z.string() });

// ---- Metrics ---------------------------------------------------------------
export const MetricSeriesSchema = obj({
  end: num(),
  result: list(obj({ values: z.array(z.tuple([numish, numish])).catch([]), applet: str() })),
});
const usageSample = obj({ value: z.array(numish).catch([]), applet: str() });
export const MetricsSummarySchema = obj({
  cpuUsage: list(usageSample),
  memoryUsage: list(usageSample),
  disksUsage: list(obj({ size: str(), usage: str(), reportedAt: str(), name: str() })),
});

// ---- Domains ---------------------------------------------------------------
export const DomainSchema = obj({
  _id: str(),
  name: str(),
  type: str(),
  project: obj({ _id: str(), project_id: str() }).optional().catch(undefined),
  status: str(),
  certificatesStatus: str(), // only "ACTIVE" is known [V]
  redirectTo: str(),
  redirectStatus: num(),
  created_at: str(),
  CNameRecord: str(),
  verificationCode: str(),
  punycodeName: str(),
  issuedAt: str(),
});
export const DomainsResponseSchema = obj({ domains: list(DomainSchema) });
export const DomainCheckResponseSchema = obj({ domain: DomainSchema });
export const CreatedDomainResponseSchema = obj({ domain: obj({ _id: str() }) });
export const ProvisionSslResponseSchema = obj({ code: str() });

// ---- Disks -----------------------------------------------------------------
export const DiskSchema = obj({ _id: str(), name: str(), size: num(), updatedAt: str(), createdAt: str(), filebrowserUrl: str() });
export const DisksResponseSchema = obj({
  disks: list(DiskSchema),
  mounts: list(obj({ name: str(), mountedTo: str() })),
});
export const BackupSchema = obj({ name: str(), lastModified: str(), etag: str(), size: num() });
export const BackupsResponseSchema = obj({ backups: list(BackupSchema) });
export const BackupLinkSchema = obj({ link: z.string() });

// ---- Databases -------------------------------------------------------------
export const DatabaseSummarySchema = obj({
  _id: str(), // [CLI] id used by action endpoints
  id: str(),
  DBId: str(),
  type: str(),
  planID: str(),
  bundlePlanID: str(),
  status: str(), // "RUNNING" seen; rest [VAL]
  scale: num(),
  hostname: str(),
  publicNetwork: bool(),
  internalPort: num(),
  created_at: str(),
});
export const DatabasesResponseSchema = obj({ databases: list(DatabaseSummarySchema) });

/**
 * Detail WITHOUT credentials: a strict (stripping) object, so `root_password`
 * is dropped at parse time and cannot leak through this type.
 */
export const DatabaseDetailSchema = z.object({
  _id: str(),
  id: str(),
  DBId: str(),
  type: str(),
  planID: str(),
  bundlePlanID: str(),
  status: str(),
  scale: num(),
  hostname: str(),
  publicNetwork: bool(),
  version: str(),
  volumeSize: num(),
  created_at: str(),
  dbName: str(),
  node: obj({ _id: str(), host: str() }).optional().catch(undefined),
  port: num(),
  internalPort: num(),
  hourlyPrice: num(),
  username: str(),
  metaData: obj({ standaloneReplicaSet: bool(), privateNetwork: bool() }).optional().catch(undefined),
  network: NetworkRefSchema.nullable().optional().catch(undefined),
});
export const DatabaseDetailResponseSchema = z.object({ database: DatabaseDetailSchema });

/** Only used by `getDatabaseCredentials`. Contains the clear-text root password. */
export const DatabaseCredentialsRawSchema = z.object({
  database: z.object({
    hostname: str(),
    username: str(),
    root_password: str(),
    dbName: str(),
    port: num(),
    internalPort: num(),
    publicNetwork: bool(),
    node: obj({ host: str() }).optional().catch(undefined),
  }),
});
export const CreatedDatabaseSchema = obj({ databaseID: str() });
export const DatabaseEventsResponseSchema = obj({
  data: z.array(z.unknown()).catch([]),
});

// ---- Networks --------------------------------------------------------------
export const NetworkSchema = obj({ _id: str(), name: str(), createdAt: str() });
export const NetworksResponseSchema = obj({ networks: list(NetworkSchema) });

// ---- Account ---------------------------------------------------------------
/**
 * `GET /v1/me`. Verified live 2026-10-23: with `?teamID=` the response also has a `team` object
 * (`isTeam:true`, `teamName`, `balance`, `teamMemberRole`, `teamMemberPermissions`, feature flags) while `user`
 * stays the person. Without a team id there is no `team` key. Use `normalizeAccount` to pick the right one.
 */
export const MeSchema = obj({
  user: obj({
    _id: str(),
    fullname: str(),
    email: str(),
    isTeam: bool(),
    isTeamCreator: bool(),
    privateNetworkFeature: bool(),
    legacyNetworkFeature: bool(),
  }).optional().catch(undefined),
  team: obj({
    _id: str(),
    isTeam: bool(),
    teamName: str(),
    teamCreator: str(),
    balance: num(),
    accountType: str(),
    minCreditAmount: num(),
    isManualMinCredit: bool(),
    teamMemberRole: str(),
    /** Shape not verified: carried through as data only. */
    teamMemberPermissions: z.unknown().optional(),
    privateNetworkFeature: bool(),
    legacyNetworkFeature: bool(),
  }).optional().catch(undefined),
  databaseVersions: anyRec(),
  defaultDatabaseVersions: anyRec(),
  featureFlags: z.array(z.unknown()).optional().catch(undefined),
  plans: obj({
    projects: anyRec(),
    projectBundlePlans: anyRec(),
    databases: anyRec(),
    databaseBundlePlans: anyRec(),
  }).optional().catch(undefined),
});
const BillingPartySchema = obj({ balance: num(), accountType: str(), minCreditAmount: num(), isManualMinCredit: bool() });
/**
 * `GET /v1/billing`. Verified live 2026-10-23: with `?teamID=` it returns BOTH `user` (the person's own wallet) and
 * `team` (the wallet that pays for the team's resources). Use `normalizeBilling` to pick the right one.
 */
export const BillingSchema = obj({
  user: BillingPartySchema.optional().catch(undefined),
  team: BillingPartySchema.optional().catch(undefined),
});

export const AnyBodySchema = z.unknown();

// ---- Inferred types --------------------------------------------------------
export type NetworkRef = z.infer<typeof NetworkRefSchema>;
export type AppSummary = z.infer<typeof AppSummarySchema>;
export type AppDetail = z.infer<typeof AppDetailSchema>;
export type EnvVar = z.infer<typeof EnvVarSchema>;
export type Applet = z.infer<typeof AppletSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type ReleasesPage = z.infer<typeof ReleasesResponseSchema>;
export type BuildOutputLine = z.infer<typeof BuildOutputLineSchema>;
export type BuildLogsResponse = z.infer<typeof BuildLogsResponseSchema>;
export type MetricSeries = z.infer<typeof MetricSeriesSchema>;
export type MetricsSummary = z.infer<typeof MetricsSummarySchema>;
export type Domain = z.infer<typeof DomainSchema>;
export type Disk = z.infer<typeof DiskSchema>;
export type DisksResponse = z.infer<typeof DisksResponseSchema>;
export type Backup = z.infer<typeof BackupSchema>;
export type DatabaseSummary = z.infer<typeof DatabaseSummarySchema>;
export type DatabaseDetail = z.infer<typeof DatabaseDetailSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type Me = z.infer<typeof MeSchema>;
export type Billing = z.infer<typeof BillingSchema>;
