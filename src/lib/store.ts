import crypto from "crypto";
import type { AnyBulkWriteOperation, Db } from "mongodb";
import { getMongo } from "./mongo";
import type { DB } from "./types";
/**
 * MongoDB backed data store.
 *
 * Every entity of the app lives in its own collection (users, issues, …).
 * Documents keep the exact shape of the TypeScript model, so the rest of the
 * code base keeps working with plain objects; two internal fields are added:
 *
 * - `_id`  – the natural key of the row (its `id` for most collections).
 * - `_ord` – a monotonically increasing sequence number that preserves the
 *            order of the in-memory arrays (a few collections are written
 *            newest-first).
 *
 * Writes go through `mutate()`: it takes the MongoDB write lease, reloads a
 * fresh snapshot, applies the callback and writes back only the rows that
 * actually changed. Reads are served from a short lived cache and are
 * re-validated against a version counter so a reader never observes a
 * half-written database.
 */

type Row = Record<string, unknown>;

interface CollectionSpec {
  /** MongoDB collection name. */
  name: string;
  /** Field used as the document `_id`. */
  key: string;
  /** True when the app prepends rows (unshift) — read newest first. */
  newestFirst: boolean;
}

const SPECS: Record<keyof DB, CollectionSpec> = {
  users: { name: "users", key: "id", newestFirst: false },
  password_credentials: { name: "password_credentials", key: "user_id", newestFirst: false },
  sessions: { name: "sessions", key: "token_hash", newestFirst: false },
  login_attempts: { name: "login_attempts", key: "key", newestFirst: false },
  workspaces: { name: "workspaces", key: "id", newestFirst: false },
  workspace_members: { name: "workspace_members", key: "id", newestFirst: false },
  projects: { name: "projects", key: "id", newestFirst: false },
  issues: { name: "issues", key: "id", newestFirst: false },
  issue_assignments: { name: "issue_assignments", key: "id", newestFirst: false },
  submission_attachments: { name: "submission_attachments", key: "id", newestFirst: false },
  comments: { name: "comments", key: "id", newestFirst: false },
  documents: { name: "documents", key: "id", newestFirst: false },
  calendar_events: { name: "calendar_events", key: "id", newestFirst: false },
  conversations: { name: "conversations", key: "id", newestFirst: false },
  messages: { name: "messages", key: "id", newestFirst: false },
  notifications: { name: "notifications", key: "id", newestFirst: true },
  activities: { name: "activities", key: "id", newestFirst: true },
};

const COLLECTION_ENTRIES = Object.entries(SPECS) as [keyof DB, CollectionSpec][];

/** Internal collections (prefixed so they never clash with app collections). */
const META_COLLECTION = "_melouz_meta";
const LOCK_COLLECTION = "_melouz_locks";
const STATE_ID = "state";
const LOCK_ID = "db-writer";

/** How long a write lease is valid before another instance may steal it. */
const LOCK_TTL_MS = 30_000;
/** How long a writer waits for the lease before giving up. */
const LOCK_WAIT_MS = 20_000;

function cacheTtlMs(): number {
  const raw = Number.parseInt(process.env.MONGODB_CACHE_TTL_MS ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

function entityKey(spec: CollectionSpec, row: Row): string {
  const value = row[spec.key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Cannot store a row without "${spec.key}" in ${spec.name}`);
  }
  return String(value);
}

/**
 * Shape of a stored document. `_id` is the natural key of the row (always a
 * string) and `_ord` keeps the order of the in-memory arrays.
 */
interface RowDoc {
  _id: string;
  _ord?: number;
  [key: string]: unknown;
}

/** A replacement document never carries the `_id` — MongoDB keeps it. */
type RowReplacement = Omit<RowDoc, "_id">;

/** Internal bookkeeping documents. */
interface MetaDoc {
  _id: string;
  version?: number;
  writing?: boolean;
}

interface LockDoc {
  _id: string;
  owner?: string;
  expires_at?: Date;
}

function toDoc(spec: CollectionSpec, row: Row, ord: number): RowReplacement {
  const doc: RowReplacement = { _ord: ord };
  for (const [key, value] of Object.entries(row)) {
    if (key === "_id" || key === "_ord") continue;
    doc[key] = value;
  }
  return doc;
}

/**
 * Order number for a row at `index` of an array with `total` entries.
 *
 * Collections that are read newest-first keep their rows at the front of the
 * array, and are read with a *descending* sort — so the first row has to
 * carry the highest order number, otherwise the order would be reversed.
 */
function ordFor(spec: CollectionSpec, index: number, total: number): number {
  return spec.newestFirst ? total - index : index + 1;
}

function fromDoc(doc: RowDoc): Row {
  const row: Row = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id" || key === "_ord") continue;
    row[key] = value;
  }
  return row;
}

function sameRow(a: Row, b: Row): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface Loaded {
  rows: DB;
  /** collection field -> row id -> order number. */
  ords: Map<string, Map<string, number>>;
}

function maxOrd(ords: Map<string, number>): number {
  let max = 0;
  for (const value of ords.values()) if (value > max) max = value;
  return max;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

async function loadAll(mongo: Db): Promise<Loaded> {
  const rows: Record<string, Row[]> = {};
  const ords = new Map<string, Map<string, number>>();

  await Promise.all(
    COLLECTION_ENTRIES.map(async ([field, spec]) => {
      const docs = await mongo
        .collection<RowDoc>(spec.name)
        .find({})
        .sort({ _ord: spec.newestFirst ? -1 : 1 })
        .toArray();
      const list: Row[] = [];
      const map = new Map<string, number>();
      for (const doc of docs) {
        const id = String(doc._id);
        list.push(fromDoc(doc));
        map.set(id, typeof doc._ord === "number" ? doc._ord : 0);
      }
      rows[field] = list;
      ords.set(field, map);
    })
  );

  return { rows: rows as unknown as DB, ords };
}

/** Writes back only the rows that differ from the snapshot we started from. */
async function writeDiff(mongo: Db, before: Loaded, after: DB): Promise<void> {
  for (const [field, spec] of COLLECTION_ENTRIES) {
    const prevRows = before.rows[field] as Row[];
    const nextRows = after[field] as Row[];
    const prevOrds = before.ords.get(field) ?? new Map<string, number>();
    const prevMap = new Map(prevRows.map((row) => [entityKey(spec, row), row]));
    const nextMap = new Map(nextRows.map((row) => [entityKey(spec, row), row]));

    let nextOrd = maxOrd(prevOrds) + 1;
    const ops: AnyBulkWriteOperation<RowDoc>[] = [];

    for (const row of nextRows) {
      const id = entityKey(spec, row);
      const prev = prevMap.get(id);
      if (!prev) {
        ops.push({
          replaceOne: { filter: { _id: id }, replacement: toDoc(spec, row, nextOrd), upsert: true },
        });
        nextOrd += 1;
      } else if (!sameRow(prev, row)) {
        const ord = prevOrds.get(id) ?? nextOrd++;
        ops.push({
          replaceOne: { filter: { _id: id }, replacement: toDoc(spec, row, ord), upsert: true },
        });
      }
    }

    for (const row of prevRows) {
      const id = entityKey(spec, row);
      if (!nextMap.has(id)) ops.push({ deleteOne: { filter: { _id: id } } });
    }

    if (ops.length) {
      await mongo.collection<RowDoc>(spec.name).bulkWrite(ops, { ordered: false });
    }
  }
}

// ---------------------------------------------------------------------------
// Write lease + read consistency
// ---------------------------------------------------------------------------

interface WriteState {
  version: number;
  writing: boolean;
}

async function readState(mongo: Db): Promise<WriteState> {
  const doc = await mongo.collection<MetaDoc>(META_COLLECTION).findOne({ _id: STATE_ID });
  return {
    version: Number(doc?.version ?? 0),
    writing: Boolean(doc?.writing),
  };
}

/**
 * Marks the database as being written. The version is bumped once the write
 * is finished so readers can detect that they observed a stale snapshot.
 */
async function setWriteState(mongo: Db, writing: boolean): Promise<void> {
  await mongo
    .collection<MetaDoc>(META_COLLECTION)
    .updateOne(
      { _id: STATE_ID },
      writing ? { $set: { writing: true } } : { $set: { writing: false }, $inc: { version: 1 } },
      { upsert: true }
    );
}

/**
 * Acquires the exclusive write lease. It is a lease (not a lock) so a crashed
 * instance cannot block the app forever: the lease expires after
 * {@link LOCK_TTL_MS} and can then be taken over.
 */
async function acquireWriteLease(mongo: Db): Promise<string> {
  const owner = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    const updated = await mongo
      .collection<LockDoc>(LOCK_COLLECTION)
      .findOneAndUpdate(
        { _id: LOCK_ID, $or: [{ expires_at: { $lte: now } }, { owner }] },
        { $set: { owner, expires_at: expiresAt } },
        { returnDocument: "after" }
      );
    if (updated) return owner;

    try {
      await mongo
        .collection<LockDoc>(LOCK_COLLECTION)
        .insertOne({ _id: LOCK_ID, owner, expires_at: expiresAt });
      return owner;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
    await sleep(30 + Math.random() * 120);
  }

  throw new Error("Timed out waiting for the MongoDB write lease");
}

async function releaseWriteLease(mongo: Db, owner: string): Promise<void> {
  await mongo.collection<LockDoc>(LOCK_COLLECTION).deleteOne({ _id: LOCK_ID, owner });
}

/**
 * Loads a consistent snapshot: if a write is in flight (or finished while we
 * were reading) the read is retried so no caller ever sees a half-written
 * database.
 */
async function loadConsistent(): Promise<DB> {
  const { db: mongo } = await getMongo();
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readState(mongo);
    if (before.writing) {
      await sleep(25 + attempt * 25);
      continue;
    }
    const loaded = await loadAll(mongo);
    const after = await readState(mongo);
    if (!after.writing && before.version === after.version) return loaded.rows;
    await sleep(25 + attempt * 25);
  }
  const { db: fallback } = await getMongo();
  return (await loadAll(fallback)).rows;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface CacheEntry {
  rows: DB;
  loadedAt: number;
}

let cache: CacheEntry | null = null;

function invalidateCache(): void {
  cache = null;
}

/** Serializes mutations inside this process. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Returns the whole database. The result is a copy — mutating it is a no-op. */
export async function readDB(): Promise<DB> {
  const current = cache;
  if (current && Date.now() - current.loadedAt < cacheTtlMs()) {
    return structuredClone(current.rows);
  }
  const rows = await loadConsistent();
  cache = { rows, loadedAt: Date.now() };
  return structuredClone(rows);
}

/** Replaces the whole database with the given content. */
export async function writeDB(db: DB): Promise<void> {
  await enqueue(async () => {
    const { db: mongo } = await getMongo();
    const owner = await acquireWriteLease(mongo);
    try {
      await setWriteState(mongo, true);
      for (const [, spec] of COLLECTION_ENTRIES) {
        await mongo.collection<RowDoc>(spec.name).deleteMany({});
      }
      for (const [field, spec] of COLLECTION_ENTRIES) {
        const rows = db[field] as Row[];
        if (!rows.length) continue;
        const docs = rows.map((row, index) => ({
          _id: entityKey(spec, row),
          ...toDoc(spec, row, ordFor(spec, index, rows.length)),
        }));
        await mongo.collection<RowDoc>(spec.name).insertMany(docs, { ordered: false });
      }
    } finally {
      await setWriteState(mongo, false).catch(() => undefined);
      await releaseWriteLease(mongo, owner).catch(() => undefined);
      invalidateCache();
    }
  });
}

/**
 * Applies `fn` to the database and persists the result. The callback receives
 * a mutable snapshot; only the rows it changed are written back.
 */
export async function mutate<T>(fn: (db: DB) => T): Promise<T> {
  return enqueue(async () => {
    const { db: mongo } = await getMongo();
    const owner = await acquireWriteLease(mongo);
    let written = false;
    try {
      await setWriteState(mongo, true);
      const before = await loadAll(mongo);
      const draft = structuredClone(before.rows) as DB;
      const result = fn(draft);
      await writeDiff(mongo, before, draft);
      written = true;
      return result;
    } finally {
      await setWriteState(mongo, false).catch(() => undefined);
      await releaseWriteLease(mongo, owner).catch(() => undefined);
      if (written) invalidateCache();
    }
  });
}

/** Approximate size of the database in bytes. */
export async function dbRawSizeBytes(): Promise<number> {
  try {
    const { db: mongo } = await getMongo();
    const stats = await mongo.command({ dbStats: 1 });
    const size = Number(stats?.storageSize ?? stats?.dataSize ?? 0);
    if (Number.isFinite(size) && size > 0) return size;
  } catch {
    // Fall back to the in-memory size below.
  }
  const db = await readDB();
  return Buffer.byteLength(JSON.stringify(db));
}

/** Per collection statistics used by the storage admin screen. */
export async function collectionStats(): Promise<
  { name: string; count: number; bytes: number }[]
> {
  const { db: mongo } = await getMongo();
  const entries = await Promise.all(
    COLLECTION_ENTRIES.map(async ([, spec]) => {
      const collection = mongo.collection<RowDoc>(spec.name);
      const count = await collection.estimatedDocumentCount();
      let bytes = 0;
      try {
        const stats = await mongo.command({ collStats: spec.name });
        bytes = Number(stats?.size ?? 0);
      } catch {
        bytes = 0;
      }
      return { name: spec.name, count, bytes };
    })
  );
  entries.sort((a, b) => b.bytes - a.bytes);
  return entries;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
