import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import type { DB, User, Workspace } from "./types";

// The JSON data store intentionally lives OUTSIDE the project directory.
// In development, Next.js/Turbopack watches the project tree; writing the DB
// inside it (e.g. ./data/db.json) triggers a full dev recompile on every
// mutation, which surfaces as a "Compiling…" overlay and re-render for every
// connected user. Keeping the file out of the watched tree avoids that.
// Override with MELOUZ_DATA_DIR if you want a specific location.
function resolveDataDir(): string {
  if (process.env.MELOUZ_DATA_DIR) return path.resolve(process.env.MELOUZ_DATA_DIR);
  const root = path.join(os.homedir(), ".melouz-os");
  return path.join(root, "data");
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, "db.json");
const LEGACY_DB_PATH = path.join(process.cwd(), "data", "db.json");

const DB_BLOB_PATHNAME = process.env.MELOUZ_DB_BLOB_PATH || "melouz/db.json";
const BLOB_READ_TTL_MS = 4000;
const MUTATE_RETRY_LIMIT = 6;

export function isBlobStore(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

function migrateLegacyDb(): void {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ DB_PATH) || !fs.existsSync(/*turbopackIgnore: true*/ LEGACY_DB_PATH)) return;
    fs.mkdirSync(/*turbopackIgnore: true*/ DATA_DIR, { recursive: true });
    fs.copyFileSync(/*turbopackIgnore: true*/ LEGACY_DB_PATH, DB_PATH);
  } catch {
    // best effort; fall through to empty DB
  }
}

const EMPTY_DB: DB = {
  users: [],
  password_credentials: [],
  sessions: [],
  login_attempts: [],
  workspaces: [],
  workspace_members: [],
  projects: [],
  issues: [],
  issue_assignments: [],
  submission_attachments: [],
  comments: [],
  documents: [],
  calendar_events: [],
  conversations: [],
  messages: [],
  notifications: [],
  activities: [],
};

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function backfill(parsed: Partial<DB>): DB {
  const db: DB = { ...structuredClone(EMPTY_DB), ...parsed };
  db.users = (db.users ?? []).map((u) => {
    const legacy = u as Partial<User>;
    return {
      ...u,
      requested_role: legacy.requested_role ?? "employee",
      approval_status: legacy.approval_status ?? "approved",
      approved_at: legacy.approved_at ?? u.created_at ?? null,
      approved_by: legacy.approved_by ?? null,
      rejection_reason: legacy.rejection_reason ?? null,
    };
  });
  db.workspaces = (db.workspaces ?? []).map((w) => {
    const legacy = w as Partial<Workspace>;
    return { ...w, is_company: legacy.is_company ?? false };
  });
  db.issue_assignments = (db.issue_assignments ?? []).map((a) => {
    const legacy = a as typeof a & { submit_count?: number; resubmit_count?: number };
    return {
      ...a,
      submit_count: legacy.submit_count ?? (a.submitted_at ? 1 : 0),
      resubmit_count: legacy.resubmit_count ?? 0,
    };
  });
  db.sessions = (db.sessions ?? []).map((s) => {
    const legacy = s as typeof s & { token?: string };
    const token_hash = s.token_hash ?? (legacy.token ? hashSessionToken(legacy.token) : "");
    const clean = { ...s, token_hash } as DB["sessions"][number];
    delete (clean as { token?: string }).token;
    return clean;
  }).filter((s) => s.token_hash);
  db.submission_attachments = (db.submission_attachments ?? []).map((a) => ({
    ...a,
    data_url: a.data_url ?? null,
    blob_pathname: a.blob_pathname ?? null,
  }));
  db.login_attempts = db.login_attempts ?? [];
  return db;
}

function loadFileDb(): DB {
  try {
    migrateLegacyDb();
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ DB_PATH, "utf8");
    return backfill(JSON.parse(raw) as Partial<DB>);
  } catch {
    return structuredClone(EMPTY_DB);
  }
}

function persistFileDb(db: DB): void {
  if (!fs.existsSync(/*turbopackIgnore: true*/ DATA_DIR))
    fs.mkdirSync(/*turbopackIgnore: true*/ DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(/*turbopackIgnore: true*/ tmp, DB_PATH);
}

// ---------------------------------------------------------------------------
// Vercel Blob backend (used when deployed on Vercel). The whole DB lives in a
// single private blob; writes use ETag conditional puts (optimistic locking)
// so concurrent serverless instances cannot silently drop each other's writes.
// ---------------------------------------------------------------------------

interface BlobCache {
  db: DB;
  etag: string | null;
  loadedAt: number;
}

interface BlobStoreState {
  cache: BlobCache | null;
  queue: Promise<unknown>;
}

function getState(): BlobStoreState {
  const g = globalThis as typeof globalThis & { __melouz_store?: BlobStoreState };
  if (!g.__melouz_store) g.__melouz_store = { cache: null, queue: Promise.resolve() };
  return g.__melouz_store;
}

async function readDbBlob(): Promise<BlobCache> {
  let result;
  try {
    result = await get(DB_BLOB_PATHNAME, { access: "private", useCache: false });
  } catch (err) {
    if (err instanceof Error && err.name === "BlobNotFoundError") result = null;
    else throw err;
  }
  if (!result) return { db: structuredClone(EMPTY_DB), etag: null, loadedAt: Date.now() };
  const text = await new Response(result.stream).text();
  const etag = (result.blob as { etag?: string }).etag ?? null;
  try {
    return { db: backfill(JSON.parse(text) as Partial<DB>), etag, loadedAt: Date.now() };
  } catch {
    return { db: structuredClone(EMPTY_DB), etag, loadedAt: Date.now() };
  }
}

async function loadBlobDb(force: boolean): Promise<BlobCache> {
  const state = getState();
  if (!force && state.cache && Date.now() - state.cache.loadedAt < BLOB_READ_TTL_MS) {
    return state.cache;
  }
  state.cache = await readDbBlob();
  return state.cache;
}

async function writeDbBlob(db: DB, etag: string | null): Promise<string | null> {
  const body = JSON.stringify(db);
  const options = {
    access: "private" as const,
    contentType: "application/json",
    allowOverwrite: true,
    ...(etag ? { ifMatch: etag } : {}),
  };
  try {
    const result = await put(DB_BLOB_PATHNAME, body, options);
    return (result as { etag?: string }).etag ?? null;
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) return null; // conflict
    throw err;
  }
}

async function mutateBlob<T>(fn: (db: DB) => T): Promise<T> {
  const state = getState();
  let lastError: unknown;
  for (let attempt = 0; attempt < MUTATE_RETRY_LIMIT; attempt++) {
    const cache = await loadBlobDb(attempt > 0);
    const draft = structuredClone(cache.db);
    const result = fn(draft);
    const newEtag = await writeDbBlob(draft, cache.etag);
    if (newEtag !== null) {
      state.cache = { db: draft, etag: newEtag, loadedAt: Date.now() };
      return result;
    }
    lastError = new BlobPreconditionFailedError();
  }
  console.error("[store] blob write conflict: too many concurrent mutations");
  throw lastError ?? new Error("Failed to persist database");
}

// ---------------------------------------------------------------------------
// Public API (async so it works with both the local file and Vercel Blob)
// ---------------------------------------------------------------------------

let fileQueue: Promise<unknown> = Promise.resolve();

function enqueueFile<T>(fn: () => T): Promise<T> {
  const run = fileQueue.then(fn, fn);
  fileQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function readDB(): Promise<DB> {
  if (isBlobStore()) {
    return structuredClone((await loadBlobDb(false)).db);
  }
  return loadFileDb();
}

export async function writeDB(db: DB): Promise<void> {
  if (isBlobStore()) {
    const state = getState();
    const run = state.queue.then(
      async () => {
        const cache = await loadBlobDb(true);
        const newEtag = await writeDbBlob(db, cache.etag);
        if (newEtag === null) throw new Error("Database write conflict; please retry");
        state.cache = { db: structuredClone(db), etag: newEtag, loadedAt: Date.now() };
      },
      async () => {
        const cache = await loadBlobDb(true);
        const newEtag = await writeDbBlob(db, cache.etag);
        if (newEtag === null) throw new Error("Database write conflict; please retry");
        state.cache = { db: structuredClone(db), etag: newEtag, loadedAt: Date.now() };
      }
    );
    state.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
  return enqueueFile(() => persistFileDb(db));
}

export async function mutate<T>(fn: (db: DB) => T): Promise<T> {
  if (isBlobStore()) {
    const state = getState();
    const run = state.queue.then(
      () => mutateBlob(fn),
      () => mutateBlob(fn)
    );
    state.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
  return enqueueFile(() => {
    const db = loadFileDb();
    const result = fn(db);
    persistFileDb(db);
    return result;
  });
}

export async function dbRawSizeBytes(): Promise<number> {
  const db = await readDB();
  return Buffer.byteLength(JSON.stringify(db));
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
