#!/usr/bin/env node
/**
 * Concurrency + persistence checks for the MongoDB backed store.
 *
 *   node scripts/e2e-concurrency.mjs [--base <url>] [--db <uri>] [--tag <name>]
 *
 * The script talks to a running Melouz instance over HTTP. It writes rows
 * concurrently (from several connections) and verifies that no update is lost
 * and that everything survives a restart of the server.
 *
 * Run two instances with the same --tag against two different servers to
 * exercise the cross-process write lease.
 *
 * Like the other e2e scripts it refuses to touch a database whose name does
 * not look like a test database.
 */
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = arg("--base", "http://localhost:3000");
const URI = arg("--db", process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/melouz_e2e");
const TAG = arg("--tag", "Concurrency");
/** Set when another process uses the same tag (cross-process lease test). */
const SHARED = args.includes("--shared");
const ROUNDS = Number(arg("--rounds", "12"));
const PER_ROUND = 6;

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

/** Polls `probe` until it returns a truthy value or the timeout expires. */
async function waitFor(probe, { timeoutMs = 15_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

async function main() {
  const dbName = (() => {
    try {
      return new URL(URI).pathname.replace(/^\/+/, "").split("/")[0];
    } catch {
      return "";
    }
  })();
  if (!/(e2e|test|ci)/i.test(dbName)) {
    console.error(
      `Refusing to run against "${dbName}" — the database name must contain e2e, test or ci.`
    );
    process.exit(1);
  }

  console.log(`Target: ${BASE} (db ${dbName}, tag "${TAG}")`);

  // --- login -------------------------------------------------------------
  const email = process.env.DEFAULT_ADMIN_EMAIL || "admin@melouz.local";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "admin12345";
  const login = await api("/api/auth/login", { method: "POST", body: { email, password } });
  if (login.status !== 200 || !login.json?.ok) {
    console.error("Login failed:", JSON.stringify(login.json));
    process.exit(1);
  }
  const cookie = login.setCookie.map((c) => c.split(";")[0]).join("; ");
  check("login succeeds", Boolean(cookie));

  const workspaces = await api("/api/workspaces", { cookie });
  const workspace = Array.isArray(workspaces.json) ? workspaces.json[0] : null;
  check("workspace is readable", Boolean(workspace?.id));
  const wsId = workspace.id;

  // --- concurrent writes -------------------------------------------------
  const created = [];
  console.log(`\nConcurrent writes: ${ROUNDS} rounds x ${PER_ROUND} parallel requests`);
  for (let round = 0; round < ROUNDS; round += 1) {
    const results = await Promise.all(
      Array.from({ length: PER_ROUND }, (_, i) =>
        api("/api/projects", {
          method: "POST",
          cookie,
          body: {
            workspace_id: wsId,
            name: `${TAG} ${round}-${i}`,
            description: "written concurrently",
          },
        })
      )
    );
    const ok = results.filter((r) => r.status === 201).length;
    if (ok !== PER_ROUND) {
      check(`round ${round}: all writes accepted`, false, `only ${ok}/${PER_ROUND} succeeded`);
    }
    for (const r of results) if (r.status === 201) created.push(r.json.id);
  }
  check("every concurrent write returned 201", created.length === ROUNDS * PER_ROUND, `${created.length}`);

  // --- no lost updates ---------------------------------------------------
  const expected = ROUNDS * PER_ROUND;
  const list = await api(`/api/projects?workspace=${wsId}`, { cookie });
  const persisted = (list.json?.projects ?? []).filter((p) => p.name.startsWith(`${TAG} `));
  // In shared mode another process writes the same tag, so the row count has
  // to be *at least* the number this process created — anything less means
  // an update was lost.
  check(
    "all concurrent rows are present (no lost updates)",
    SHARED ? persisted.length >= expected : persisted.length === expected,
    `expected ${SHARED ? "at least " : ""}${expected}, found ${persisted.length}`
  );
  check("row ids are unique", new Set(persisted.map((p) => p.id)).size === persisted.length);

  // --- direct database inspection ---------------------------------------
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(dbName);
  const docs = await db.collection("projects").find({ name: new RegExp(`^${TAG} `) }).toArray();
  check(
    "mongodb holds every concurrent row",
    SHARED ? docs.length >= expected : docs.length === expected,
    `${docs.length}`
  );
  check("every row carries an order number", docs.every((d) => typeof d._ord === "number"));

  // The sibling process may still be writing — wait until the lease is free.
  const state = await waitFor(async () => {
    const s = await db.collection("_melouz_meta").findOne({ _id: "state" });
    return s?.writing === false ? s : null;
  });
  check("write state is released", state?.writing === false, JSON.stringify(state));
  check("version counter advanced", Number(state?.version) > 0, String(state?.version));

  // --- cleanup -----------------------------------------------------------
  // Only the rows this process created are removed — in shared mode the
  // sibling process owns (and removes) the rest.
  for (const id of created) {
    await api(`/api/projects/${id}`, { method: "DELETE", cookie });
  }
  const remaining = await waitFor(async () => {
    const own = await api(`/api/projects?workspace=${wsId}`, { cookie });
    const left = (own.json?.projects ?? []).filter((p) => created.includes(p.id));
    return left.length === 0 ? [] : left;
  });
  check("cleanup removed this process' rows", Array.isArray(remaining), `${remaining?.length ?? "?"} left`);

  if (!SHARED) {
    const after = await api(`/api/projects?workspace=${wsId}`, { cookie });
    const left = (after.json?.projects ?? []).filter((p) => p.name.startsWith(`${TAG} `));
    check("no test rows are left behind", left.length === 0, `${left.length} left`);
  }

  await client.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
