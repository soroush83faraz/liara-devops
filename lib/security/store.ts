import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SAFE_ID_RE } from "../contracts/common";
import { AuditEntrySchema, type AuditEntry } from "../contracts/audit";
import { CanvasLayoutSchema, type CanvasLayout } from "../contracts/layout";
import {
  IncidentSchema,
  ProposalSchema,
  TERMINAL_PROPOSAL_STATUSES,
  type Incident,
  type Proposal,
} from "../contracts/proposal";
import { sha256Hex } from "./canonical";

/**
 * Persistence for small per-account state (layouts, proposals, nonces, incidents,
 * audit). Two implementations share one engine: JSON files under DATA_DIR (a Liara
 * disk in production) and an in-memory map for tests.
 *
 * SECURITY:
 *  - Account directories are named by a hash of the account id; document ids must
 *    match /^[a-zA-Z0-9_-]{1,64}$/ and the resolved path is re-checked against the
 *    base directory, so no id can traverse (`../`, absolute paths, NUL, unicode).
 *  - Writes are atomic (temp file + rename, mode 0600) and serialized per
 *    account+collection by an in-process mutex shared across module copies.
 *  - Values are schema-validated on write and on read; a corrupt proposal or nonce
 *    file fails closed (throws) instead of being treated as absent.
 *  - Assumption: a single server process owns DATA_DIR (Liara disks attach to one
 *    app). The mutex does not coordinate between processes.
 */

export const STORE_NAMESPACES = ["layouts", "proposals", "nonces", "incidents", "audit"] as const;
export type StoreNamespace = (typeof STORE_NAMESPACES)[number];

export type StoreErrorCode = "invalid_id" | "invalid_account" | "invalid_value" | "corrupt" | "too_large" | "full";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

export interface DocCollection<T> {
  get(accountId: string, id: string): Promise<T | undefined>;
  /** Validates, then atomically writes. Throws StoreError('full') when the cap is reached. */
  put(accountId: string, id: string, value: T): Promise<void>;
  /**
   * Atomic read-modify-write under the collection lock. `fn` returns the next value,
   * or `undefined` to leave the document unchanged. `fn` must not call the store.
   * Resolves to the stored value afterwards.
   */
  update(
    accountId: string,
    id: string,
    fn: (current: T | undefined) => T | undefined | Promise<T | undefined>,
  ): Promise<T | undefined>;
  delete(accountId: string, id: string): Promise<boolean>;
  /** Newest first. */
  list(accountId: string, opts?: { limit?: number }): Promise<T[]>;
}

export interface NonceCollection {
  /**
   * Atomically records a one-time nonce. Resolves false when it was already used,
   * is already expired, or the per-account nonce table is full (fail closed).
   */
  consume(accountId: string, nonce: string, expiresAtMs: number, nowMs?: number): Promise<boolean>;
}

export interface AuditLog {
  /** Appends an already-redacted entry (use lib/security/audit.appendAudit). */
  append(accountId: string, entry: AuditEntry): Promise<void>;
  /** Newest first. */
  read(accountId: string, opts?: { limit?: number }): Promise<AuditEntry[]>;
}

export interface Store {
  readonly layouts: DocCollection<CanvasLayout>;
  readonly proposals: DocCollection<Proposal>;
  readonly incidents: DocCollection<Incident>;
  readonly nonces: NonceCollection;
  readonly audit: AuditLog;
}

export interface StoreLimits {
  maxProposals: number;
  maxIncidents: number;
  maxLayouts: number;
  maxNonces: number;
  maxDocBytes: number;
  auditRotateBytes: number;
  auditKeepRotated: number;
}

export const DEFAULT_STORE_LIMITS: Readonly<StoreLimits> = Object.freeze({
  maxProposals: 500,
  maxIncidents: 200,
  maxLayouts: 50,
  maxNonces: 10_000,
  maxDocBytes: 1024 * 1024,
  auditRotateBytes: 5 * 1024 * 1024,
  auditKeepRotated: 2,
});

const MAX_AUDIT_LINE_BYTES = 16 * 1024;
const MAX_AUDIT_READ = 1000;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/* ---------------------------------------------------------------- paths */

export function assertSafeId(id: unknown, what = "id"): asserts id is string {
  if (typeof id !== "string" || !SAFE_ID_RE.test(id)) {
    throw new StoreError("invalid_id", `invalid ${what}`);
  }
}

/** Directory name for an account: a hash, so the raw id never reaches the filesystem. */
export function accountDirName(accountId: unknown): string {
  if (typeof accountId !== "string" || accountId.length === 0 || accountId.length > 512) {
    throw new StoreError("invalid_account", "invalid account id");
  }
  return sha256Hex(`hamyar.account.v1\n${accountId}`).slice(0, 40);
}

/* -------------------------------------------------------------- backend */

interface Backend {
  /** Namespaces the in-process locks. */
  readonly id: string;
  read(rel: string, maxBytes: number): Promise<string | undefined>;
  write(rel: string, data: string): Promise<void>;
  remove(rel: string): Promise<boolean>;
  list(relDir: string): Promise<string[]>;
  append(rel: string, data: string): Promise<void>;
  size(rel: string): Promise<number>;
  rename(fromRel: string, toRel: string): Promise<void>;
}

function isErrno(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;
}

function fileBackend(dataDir: string): Backend {
  const base = path.resolve(dataDir, "v1");
  const resolve = (rel: string) => {
    const p = path.resolve(base, rel);
    if (!p.startsWith(base + path.sep)) throw new StoreError("invalid_id", "path escapes data dir");
    return p;
  };
  const ensureDir = (p: string) => fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });

  return {
    id: `file:${base}`,
    async read(rel, maxBytes) {
      const p = resolve(rel);
      let st;
      try {
        st = await fs.lstat(p);
      } catch (e) {
        if (isErrno(e, "ENOENT")) return undefined;
        throw e;
      }
      if (!st.isFile()) throw new StoreError("corrupt", "not a regular file");
      if (st.size > maxBytes) throw new StoreError("too_large", "stored document too large");
      return fs.readFile(p, "utf8");
    },
    async write(rel, data) {
      const p = resolve(rel);
      await ensureDir(p);
      const tmp = `${p}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        const fh = await fs.open(tmp, "wx", 0o600);
        try {
          await fh.writeFile(data, "utf8");
          await fh.sync();
        } finally {
          await fh.close();
        }
        await fs.rename(tmp, p);
      } catch (e) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw e;
      }
    },
    async remove(rel) {
      try {
        await fs.unlink(resolve(rel));
        return true;
      } catch (e) {
        if (isErrno(e, "ENOENT")) return false;
        throw e;
      }
    },
    async list(relDir) {
      try {
        return await fs.readdir(resolve(relDir));
      } catch (e) {
        if (isErrno(e, "ENOENT")) return [];
        throw e;
      }
    },
    async append(rel, data) {
      const p = resolve(rel);
      await ensureDir(p);
      await fs.appendFile(p, data, { encoding: "utf8", mode: 0o600 });
    },
    async size(rel) {
      try {
        return (await fs.lstat(resolve(rel))).size;
      } catch (e) {
        if (isErrno(e, "ENOENT")) return 0;
        throw e;
      }
    },
    async rename(fromRel, toRel) {
      try {
        await fs.rename(resolve(fromRel), resolve(toRel));
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e;
      }
    },
  };
}

function memoryBackend(): Backend {
  const files = new Map<string, string>();
  const norm = (rel: string) => path.posix.normalize(rel);
  return {
    id: `memory:${randomBytes(8).toString("hex")}`,
    async read(rel, maxBytes) {
      const v = files.get(norm(rel));
      if (v !== undefined && Buffer.byteLength(v) > maxBytes) throw new StoreError("too_large", "stored document too large");
      return v;
    },
    async write(rel, data) {
      files.set(norm(rel), data);
    },
    async remove(rel) {
      return files.delete(norm(rel));
    },
    async list(relDir) {
      const prefix = `${norm(relDir)}/`;
      return [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => k.slice(prefix.length));
    },
    async append(rel, data) {
      files.set(norm(rel), (files.get(norm(rel)) ?? "") + data);
    },
    async size(rel) {
      const v = files.get(norm(rel));
      return v === undefined ? 0 : Buffer.byteLength(v);
    },
    async rename(fromRel, toRel) {
      const v = files.get(norm(fromRel));
      if (v === undefined) return;
      files.set(norm(toRel), v);
      files.delete(norm(fromRel));
    },
  };
}

/* ---------------------------------------------------------------- locks */

const LOCKS_KEY = Symbol.for("hamyar.store.locks.v1");

function lockTable(): Map<string, Promise<void>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<void>> | undefined>;
  let table = g[LOCKS_KEY];
  if (!table) {
    table = new Map();
    g[LOCKS_KEY] = table;
  }
  return table;
}

/** FIFO mutex keyed by string; never rejects the chain, always releases. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const table = lockTable();
  const prev = table.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => mine);
  table.set(key, tail);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (table.get(key) === tail) table.delete(key);
  }
}

/* ---------------------------------------------------------- collections */

interface DocSpec<T> {
  ns: "layouts" | "proposals" | "incidents";
  schema: z.ZodType<T>;
  max: number;
  /** Corrupt documents: proposals fail closed, the rest are treated as absent. */
  onCorrupt: "throw" | "ignore";
  order: (v: T) => number;
  evictable: (v: T) => boolean;
  idOf?: (v: T) => string;
}

function parseDoc<T>(raw: string, schema: z.ZodType<T>): T | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const r = schema.safeParse(json);
  return r.success ? r.data : undefined;
}

function makeCollection<T>(backend: Backend, limits: StoreLimits, spec: DocSpec<T>): DocCollection<T> {
  const dirOf = (accountId: string) => `${accountDirName(accountId)}/${spec.ns}`;
  const fileOf = (accountId: string, id: string) => {
    assertSafeId(id);
    return `${dirOf(accountId)}/${id}.json`;
  };
  const lockOf = (accountId: string) => `${backend.id}:${dirOf(accountId)}`;

  const readOne = async (rel: string): Promise<T | undefined> => {
    const raw = await backend.read(rel, limits.maxDocBytes);
    if (raw === undefined) return undefined;
    const v = parseDoc(raw, spec.schema);
    if (v === undefined && spec.onCorrupt === "throw") throw new StoreError("corrupt", `corrupt ${spec.ns} document`);
    return v;
  };

  const validate = (id: string, value: unknown): { value: T; json: string } => {
    const r = spec.schema.safeParse(value);
    if (!r.success) throw new StoreError("invalid_value", `invalid ${spec.ns} value: ${r.error.issues[0]?.message ?? "schema"}`);
    if (spec.idOf && spec.idOf(r.data) !== id) throw new StoreError("invalid_value", "document id mismatch");
    const json = JSON.stringify(r.data);
    if (Buffer.byteLength(json) > limits.maxDocBytes) throw new StoreError("too_large", `${spec.ns} document too large`);
    return { value: r.data, json };
  };

  const docNames = async (accountId: string) =>
    (await backend.list(dirOf(accountId))).filter((n) => /^[a-zA-Z0-9_-]{1,64}\.json$/.test(n));

  /** Makes room for one new document; throws when only non-evictable documents remain. */
  const ensureRoom = async (accountId: string) => {
    const names = await docNames(accountId);
    if (names.length < spec.max) return;
    const docs: Array<{ name: string; v: T | undefined }> = [];
    for (const name of names) {
      let v: T | undefined;
      try {
        v = parseDoc((await backend.read(`${dirOf(accountId)}/${name}`, limits.maxDocBytes)) ?? "", spec.schema);
      } catch {
        v = undefined;
      }
      docs.push({ name, v });
    }
    // Unreadable documents go first, then the oldest evictable ones.
    const victims = docs
      .filter((d) => d.v === undefined || spec.evictable(d.v))
      .sort((a, b) => (a.v === undefined ? -Infinity : spec.order(a.v)) - (b.v === undefined ? -Infinity : spec.order(b.v)));
    const needed = names.length - spec.max + 1;
    if (victims.length < needed) throw new StoreError("full", `${spec.ns} limit reached`);
    for (const victim of victims.slice(0, needed)) await backend.remove(`${dirOf(accountId)}/${victim.name}`);
  };

  return {
    async get(accountId, id) {
      return readOne(fileOf(accountId, id));
    },
    async put(accountId, id, value) {
      const file = fileOf(accountId, id);
      const { json } = validate(id, value);
      await withLock(lockOf(accountId), async () => {
        if ((await backend.read(file, limits.maxDocBytes).catch(() => undefined)) === undefined) await ensureRoom(accountId);
        await backend.write(file, json);
      });
    },
    async update(accountId, id, fn) {
      const file = fileOf(accountId, id);
      return withLock(lockOf(accountId), async () => {
        const current = await readOne(file);
        const next = await fn(current);
        if (next === undefined) return current;
        const { value, json } = validate(id, next);
        if (current === undefined) await ensureRoom(accountId);
        await backend.write(file, json);
        return value;
      });
    },
    async delete(accountId, id) {
      const file = fileOf(accountId, id);
      return withLock(lockOf(accountId), () => backend.remove(file));
    },
    async list(accountId, opts) {
      const limit = Math.max(1, Math.min(opts?.limit ?? spec.max, spec.max));
      const out: T[] = [];
      for (const name of await docNames(accountId)) {
        try {
          const raw = await backend.read(`${dirOf(accountId)}/${name}`, limits.maxDocBytes);
          const v = raw === undefined ? undefined : parseDoc(raw, spec.schema);
          if (v !== undefined) out.push(v);
        } catch {
          // skip unreadable entries in listings
        }
      }
      return out.sort((a, b) => spec.order(b) - spec.order(a)).slice(0, limit);
    },
  };
}

const NonceTableSchema = z.record(z.string().regex(NONCE_RE), z.number());

function makeNonces(backend: Backend, limits: StoreLimits): NonceCollection {
  return {
    async consume(accountId, nonce, expiresAtMs, nowMs = Date.now()) {
      if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) throw new StoreError("invalid_id", "invalid nonce");
      if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) throw new StoreError("invalid_value", "invalid time");
      if (expiresAtMs <= nowMs) return false;
      const file = `${accountDirName(accountId)}/nonces.json`;
      return withLock(`${backend.id}:${file}`, async () => {
        const raw = await backend.read(file, limits.maxDocBytes * 2);
        const table = new Map<string, number>();
        if (raw !== undefined) {
          const parsed = parseDoc(raw, NonceTableSchema);
          // Cannot tell whether this nonce was used: fail closed.
          if (parsed === undefined) throw new StoreError("corrupt", "corrupt nonce table");
          for (const [k, exp] of Object.entries(parsed)) if (exp > nowMs) table.set(k, exp);
        }
        if (table.has(nonce)) return false;
        if (table.size >= limits.maxNonces) return false;
        table.set(nonce, expiresAtMs);
        await backend.write(file, JSON.stringify(Object.fromEntries(table)));
        return true;
      });
    },
  };
}

function makeAudit(backend: Backend, limits: StoreLimits): AuditLog {
  const dirOf = (accountId: string) => `${accountDirName(accountId)}/audit`;
  const fileName = (i: number) => (i === 0 ? "audit.jsonl" : `audit.${i}.jsonl`);
  return {
    async append(accountId, entry) {
      const r = AuditEntrySchema.safeParse(entry);
      if (!r.success) throw new StoreError("invalid_value", "invalid audit entry");
      const line = `${JSON.stringify(r.data)}\n`;
      const bytes = Buffer.byteLength(line);
      if (bytes > MAX_AUDIT_LINE_BYTES) throw new StoreError("too_large", "audit entry too large");
      const dir = dirOf(accountId);
      await withLock(`${backend.id}:${dir}`, async () => {
        if ((await backend.size(`${dir}/${fileName(0)}`)) + bytes > limits.auditRotateBytes) {
          for (let i = limits.auditKeepRotated; i >= 1; i--) {
            await backend.rename(`${dir}/${fileName(i - 1)}`, `${dir}/${fileName(i)}`);
          }
        }
        await backend.append(`${dir}/${fileName(0)}`, line);
      });
    },
    async read(accountId, opts) {
      const limit = Math.max(1, Math.min(opts?.limit ?? 100, MAX_AUDIT_READ));
      const dir = dirOf(accountId);
      const out: AuditEntry[] = [];
      for (let i = 0; i <= limits.auditKeepRotated && out.length < limit; i++) {
        const raw = await backend.read(`${dir}/${fileName(i)}`, limits.auditRotateBytes + MAX_AUDIT_LINE_BYTES);
        if (raw === undefined) continue;
        const lines = raw.split("\n");
        for (let j = lines.length - 1; j >= 0 && out.length < limit; j--) {
          if (lines[j] === "") continue;
          const v = parseDoc(lines[j], AuditEntrySchema);
          if (v !== undefined) out.push(v);
        }
      }
      return out;
    },
  };
}

const terminal = new Set<string>(TERMINAL_PROPOSAL_STATUSES);
const time = (iso: string | undefined) => {
  const t = iso === undefined ? NaN : Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

function buildStore(backend: Backend, partial?: Partial<StoreLimits>): Store {
  const limits: StoreLimits = { ...DEFAULT_STORE_LIMITS, ...partial };
  return Object.freeze({
    layouts: makeCollection<CanvasLayout>(backend, limits, {
      ns: "layouts",
      schema: CanvasLayoutSchema,
      max: limits.maxLayouts,
      onCorrupt: "ignore",
      order: (v) => time(v.updatedAt),
      evictable: () => true,
    }),
    proposals: makeCollection<Proposal>(backend, limits, {
      ns: "proposals",
      schema: ProposalSchema,
      max: limits.maxProposals,
      onCorrupt: "throw",
      order: (v) => time(v.createdAt),
      evictable: (v) => terminal.has(v.status),
      idOf: (v) => v.id,
    }),
    incidents: makeCollection<Incident>(backend, limits, {
      ns: "incidents",
      schema: IncidentSchema,
      max: limits.maxIncidents,
      onCorrupt: "ignore",
      order: (v) => time(v.startedAt),
      evictable: () => true,
      idOf: (v) => v.id,
    }),
    nonces: makeNonces(backend, limits),
    audit: makeAudit(backend, limits),
  });
}

/** JSON-file store rooted at `dataDir` (default: env DATA_DIR, else ./data). */
export function createFileStore(dataDir: string = process.env.DATA_DIR || "./data", limits?: Partial<StoreLimits>): Store {
  return buildStore(fileBackend(dataDir), limits);
}

export function createMemoryStore(limits?: Partial<StoreLimits>): Store {
  return buildStore(memoryBackend(), limits);
}

const DEFAULT_STORE_KEY = Symbol.for("hamyar.store.default.v1");

/** Process-wide file store on DATA_DIR (survives Next.js dev module reloads). */
export function getDefaultStore(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  let store = g[DEFAULT_STORE_KEY];
  if (!store) {
    store = createFileStore();
    g[DEFAULT_STORE_KEY] = store;
  }
  return store;
}
