import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
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

function migrateLegacyDb(): void {
  try {
    if (fs.existsSync(DB_PATH) || !fs.existsSync(LEGACY_DB_PATH)) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  } catch {
    // best effort; fall through to empty DB
  }
}

const EMPTY_DB: DB = {
  users: [],
  password_credentials: [],
  sessions: [],
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

function load(): DB {
  try {
    migrateLegacyDb();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DB>;
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
    return db;
  } catch {
    return structuredClone(EMPTY_DB);
  }
}

function persist(db: DB): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}

export function readDB(): DB {
  return load();
}

export function writeDB(db: DB): void {
  persist(db);
}

export function mutate<T>(fn: (db: DB) => T): T {
  const db = load();
  const result = fn(db);
  persist(db);
  return result;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
