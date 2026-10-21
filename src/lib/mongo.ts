import { MongoClient, type Db } from "mongodb";

/**
 * MongoDB connection layer.
 *
 * The connection string is read from the environment — `MONGODB_URI` — so the
 * same build can point at a local `mongod`, a Docker container or an Atlas
 * cluster without any code change. The database name is taken from
 * `MONGODB_DB` when set, otherwise from the path segment of the URI
 * (`mongodb://host:27017/my-db` -> `my-db`), otherwise `melouz` is used.
 */

export const MONGO_URI_ENV = "MONGODB_URI";

const URI_FALLBACK_ENVS = ["MONGODB_URL", "MONGO_URL", "MONGOOSE_URI"];
const DB_NAME_ENVS = ["MONGODB_DB", "MONGODB_DB_NAME", "MONGO_DB"];
const DEFAULT_DB_NAME = "melouz";

/** Thrown when the deployment is missing the connection string. */
export class MongoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoConfigError";
  }
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The MongoDB connection string, or a helpful error when it is missing. */
export function mongoUri(): string {
  for (const name of [MONGO_URI_ENV, ...URI_FALLBACK_ENVS]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new MongoConfigError(
    `${MONGO_URI_ENV} is not set. Add your MongoDB connection string to .env.local, for example: ` +
      `${MONGO_URI_ENV}=mongodb://127.0.0.1:27017/${DEFAULT_DB_NAME}`
  );
}

/** The database the app reads from and writes to. */
export function mongoDbName(uri: string = mongoUri()): string {
  for (const name of DB_NAME_ENVS) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  try {
    const parsed = new URL(uri);
    const name = parsed.pathname.replace(/^\/+/, "").split("/")[0];
    if (name) return decodeURIComponent(name);
  } catch {
    // Unparseable URI — fall back to the default database name.
  }
  return DEFAULT_DB_NAME;
}

export interface MongoHandle {
  client: MongoClient;
  db: Db;
}

const globalRef = globalThis as typeof globalThis & {
  __melouzMongo?: Promise<MongoHandle>;
};

/**
 * Returns the shared connection. The promise is cached on `globalThis` so the
 * Next.js dev server does not open a new pool on every hot reload.
 */
export async function getMongo(): Promise<MongoHandle> {
  if (!globalRef.__melouzMongo) {
    globalRef.__melouzMongo = connect().catch((err) => {
      // Allow a later request to retry (e.g. the database was not up yet).
      globalRef.__melouzMongo = undefined;
      throw err;
    });
  }
  return globalRef.__melouzMongo;
}

/** Closes the shared connection (used by scripts and graceful shutdowns). */
export async function closeMongo(): Promise<void> {
  const pending = globalRef.__melouzMongo;
  globalRef.__melouzMongo = undefined;
  if (!pending) return;
  try {
    const { client } = await pending;
    await client.close();
  } catch {
    // Already closed.
  }
}

async function connect(): Promise<MongoHandle> {
  const uri = mongoUri();
  const client = new MongoClient(uri, {
    appName: "melouz-os",
    serverSelectionTimeoutMS: intEnv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 8000),
    connectTimeoutMS: intEnv("MONGODB_CONNECT_TIMEOUT_MS", 10000),
    maxPoolSize: intEnv("MONGODB_MAX_POOL_SIZE", 10),
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(mongoDbName(uri));
  await ensureIndexes(db);
  return { client, db };
}

/**
 * Creates the indexes the app relies on. Index creation is best effort: a
 * pre-existing collection with duplicate values must not stop the app from
 * booting, so failures are logged instead of thrown.
 */
async function ensureIndexes(db: Db): Promise<void> {
  const requiredUnique = async (name: string, keys: Record<string, 1 | -1>) => {
    try {
      await db.collection(name).createIndex(keys, { unique: true });
    } catch (err) {
      throw new Error(`Required unique index failed on ${name}: ${(err as Error).message}`);
    }
  };
  const plain = async (name: string, keys: Record<string, 1 | -1>) => {
    try {
      await db.collection(name).createIndex(keys);
    } catch (err) {
      console.warn(`[mongo] could not create index on ${name}:`, (err as Error).message);
    }
  };

  await requiredUnique("users", { email: 1 });
  await requiredUnique("workspace_members", { workspace_id: 1, user_id: 1 });
  await requiredUnique("team_members", { team_id: 1, user_id: 1 });
  await requiredUnique("projects", { workspace_id: 1, key: 1 });
  await plain("projects", { workspace_id: 1 });
  await plain("issues", { project_id: 1 });
  await plain("issues", { assignee_id: 1 });
  await plain("issue_assignments", { issue_id: 1 });
  await plain("issue_assignments", { user_id: 1 });
  await plain("submission_attachments", { assignment_id: 1 });
  await plain("comments", { issue_id: 1 });
  await plain("documents", { workspace_id: 1 });
  await plain("calendar_events", { workspace_id: 1 });
  await plain("messages", { conversation_id: 1 });
  await plain("notifications", { user_id: 1 });
  await plain("activities", { workspace_id: 1 });
  await plain("teams", { workspace_id: 1 });
  await plain("team_members", { user_id: 1 });
  await plain("sessions", { user_id: 1 });
}
