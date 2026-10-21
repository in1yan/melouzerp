#!/usr/bin/env node
/**
 * Imports the legacy JSON data store into MongoDB.
 *
 *   node scripts/migrate-json-to-mongodb.mjs [--file <path>] [--force] [--dry-run]
 *
 * The connection string is read from MONGODB_URI (the same variable the app
 * uses). The JSON file defaults to the legacy store location
 * (~/.melouz-os/data/db.json) and can be overridden with --file or
 * MELOUZ_DATA_DIR.
 *
 * Attachments that were stored inline as base64 data URLs are converted into
 * real documents in the `attachment_files` collection.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoClient, Binary } from "mongodb";

const COLLECTIONS = [
  ["users", "id"],
  ["password_credentials", "user_id"],
  ["sessions", "token_hash"],
  ["login_attempts", "key"],
  ["workspaces", "id"],
  ["workspace_members", "id"],
  ["projects", "id"],
  ["issues", "id"],
  ["issue_assignments", "id"],
  ["submission_attachments", "id"],
  ["comments", "id"],
  ["documents", "id"],
  ["calendar_events", "id"],
  ["conversations", "id"],
  ["messages", "id"],
  ["notifications", "id"],
  ["activities", "id"],
];

/** Collections whose rows are stored newest-first in the app. */
const NEWEST_FIRST = new Set(["notifications", "activities"]);

function parseArgs(argv) {
  const args = { file: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") args.file = argv[++i];
    else if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/migrate-json-to-mongodb.mjs [--file <path>] [--force] [--dry-run]"
      );
      process.exit(0);
    }
  }
  return args;
}

function resolveJsonPath(explicit) {
  if (explicit) return path.resolve(explicit);
  const dir = process.env.MELOUZ_DATA_DIR
    ? path.resolve(process.env.MELOUZ_DATA_DIR)
    : path.join(os.homedir(), ".melouz-os", "data");
  return path.join(dir, "db.json");
}

function resolveDbName(uri) {
  const explicit = process.env.MONGODB_DB || process.env.MONGODB_DB_NAME || process.env.MONGO_DB;
  if (explicit) return explicit;
  try {
    const name = new URL(uri).pathname.replace(/^\/+/, "").split("/")[0];
    if (name) return decodeURIComponent(name);
  } catch {
    // ignore — fall back to the default below
  }
  return "melouz";
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64") };
}

/**
 * Minimal .env loader so `pnpm migrate:mongodb` picks up MONGODB_URI from the
 * same .env.local the app uses. Existing environment variables always win.
 */
function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    let content;
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFiles();
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error("MONGODB_URI is not set. Export it before running the migration.");
    process.exit(1);
  }

  const jsonPath = resolveJsonPath(args.file);
  if (!fs.existsSync(jsonPath)) {
    console.error(`No JSON store found at ${jsonPath}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (err) {
    console.error(`Could not read ${jsonPath}: ${err.message}`);
    process.exit(1);
  }

  const client = new MongoClient(uri, { appName: "melouz-migration" });
  await client.connect();
  const db = client.db(resolveDbName(uri));

  const existing = await db.collection("users").estimatedDocumentCount();
  if (existing > 0 && !args.force) {
    console.error(
      `The target database already contains ${existing} user(s). Re-run with --force to import anyway.`
    );
    await client.close();
    process.exit(1);
  }

  const summary = [];
  for (const [name, keyField] of COLLECTIONS) {
    const rows = Array.isArray(raw[name]) ? raw[name] : [];
    if (args.dryRun) {
      summary.push(`${name}: ${rows.length} row(s) would be imported`);
      continue;
    }
    const docs = rows.map((row, index) => {
      // Collections that are read newest-first keep the newest row at the
      // front of the array and are read with a descending sort — the newest
      // row therefore has to carry the highest order number.
      const ord = NEWEST_FIRST.has(name) ? rows.length - index : index + 1;
      const doc = { _id: String(row[keyField]), _ord: ord };
      for (const [field, value] of Object.entries(row)) {
        if (field === "_id" || field === "_ord") continue;
        doc[field] = value;
      }
      return doc;
    });
    if (docs.length) {
      await db.collection(name).deleteMany({});
      await db.collection(name).insertMany(docs, { ordered: false });
    }
    summary.push(`${name}: ${docs.length} row(s)`);
  }

  // Inline attachments (base64 data URLs) become real file documents.
  const attachments = Array.isArray(raw.submission_attachments) ? raw.submission_attachments : [];
  let fileCount = 0;
  if (!args.dryRun) {
    const files = [];
    for (const attachment of attachments) {
      if (!attachment?.data_url) continue;
      const decoded = decodeDataUrl(attachment.data_url);
      if (!decoded) continue;
      files.push({
        _id: String(attachment.id),
        filename: attachment.filename,
        content_type: attachment.content_type ?? decoded.contentType,
        size: decoded.buffer.length,
        data: new Binary(decoded.buffer),
        uploaded_at: attachment.uploaded_at,
      });
    }
    if (files.length) {
      await db.collection("attachment_files").deleteMany({});
      await db.collection("attachment_files").insertMany(files, { ordered: false });
    }
    fileCount = files.length;
    // The inline copy is now redundant — keep the metadata row, drop the blob.
    await db.collection("submission_attachments").updateMany(
      { data_url: { $ne: null } },
      { $set: { data_url: null } }
    );
  }

  console.log(summary.join("\n"));
  console.log(`attachment_files: ${fileCount} file(s)`);
  console.log(args.dryRun ? "\nDry run — nothing was written." : "\nMigration finished.");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
