/**
 * End-to-end test for the MongoDB-backed store.
 * Run with the dev server on http://localhost:3000 and MONGODB_URI set.
 */
import { MongoClient } from "mongodb";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/melouz_e2e";
const DB_NAME = process.env.MONGODB_DB ?? "melouz_e2e";

// The test wipes the database before it runs. That is only allowed for
// throw-away database names so it can never delete real data by accident.
const RESETTABLE = /(^|[_-])(e2e|test|ci)([_-]|$)/i.test(DB_NAME);
if (!RESETTABLE) {
  console.error(
    `Refusing to run: the database "${DB_NAME}" does not look like a throw-away test database. ` +
      `Use a name containing "e2e" or "test".`
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, extra = "") {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name} ${extra}`);
  }
}

/** Minimal cookie jar so each user keeps its own session. */
function client() {
  const jar = new Map();
  return {
    jar,
    async fetch(path, options = {}) {
      const headers = new Headers(options.headers ?? {});
      if (jar.size) {
        headers.set("cookie", [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
      }
      if (options.body && typeof options.body !== "string") {
        headers.set("content-type", "application/json");
        options = { ...options, body: JSON.stringify(options.body) };
      }
      const res = await fetch(`${BASE}${path}`, { ...options, headers, redirect: "manual" });
      for (const cookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const idx = pair.indexOf("=");
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === "") jar.delete(name);
        else jar.set(name, value);
      }
      return res;
    },
    async json(path, options) {
      const res = await this.fetch(path, options);
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      return { status: res.status, body };
    },
  };
}

const stamp = Date.now();
const admin = client();
const lead = client();
const employee = client();

const results = {};

// ---------------------------------------------------------------------------

async function run() {
  console.log(`\n== reset database "${DB_NAME}" ==`);
  {
    const client = new MongoClient(URI);
    await client.connect();
    await client.db(DB_NAME).dropDatabase();
    await client.close();
    console.log("  ok  database dropped");
  }

  console.log("\n== auth & bootstrap ==");
  {
    const res = await admin.json("/api/auth/login", {
      method: "POST",
      body: { email: "admin@melouz.local", password: "admin12345" },
    });
    check("admin login returns 200", res.status === 200, `got ${res.status}`);
    check("admin is the owner", res.body?.user?.email === "admin@melouz.local");
    results.adminId = res.body?.user?.id;

    const me = await admin.json("/api/auth/me");
    check("me returns the admin", me.status === 200 && me.body?.user?.email === "admin@melouz.local");
  }

  console.log("\n== signup & approvals ==");
  {
    const leadEmail = `lead${stamp}@test.local`;
    const empEmail = `emp${stamp}@test.local`;
    results.leadEmail = leadEmail;
    results.empEmail = empEmail;

    const s1 = await lead.json("/api/auth/signup", {
      method: "POST",
      body: { name: "Test Lead", email: leadEmail, password: "password123", requested_role: "lead" },
    });
    check("lead signup returns 201", s1.status === 201, `got ${s1.status}`);
    const s2 = await employee.json("/api/auth/signup", {
      method: "POST",
      body: { name: "Test Employee", email: empEmail, password: "password123", requested_role: "employee" },
    });
    check("employee signup returns 201", s2.status === 201, `got ${s2.status}`);

    const pending = await lead.json("/api/workspaces");
    check("pending user has no workspace", pending.status === 200 && pending.body.length === 0, JSON.stringify(pending.body));

    const approvals = await admin.json("/api/approvals");
    check("admin sees 2 pending requests", approvals.body?.pending?.length === 2, JSON.stringify(approvals.body?.pending?.length));
    const leadUser = approvals.body.pending.find((u) => u.email === leadEmail);
    const empUser = approvals.body.pending.find((u) => u.email === empEmail);
    results.leadId = leadUser?.id;
    results.empId = empUser?.id;

    const a1 = await admin.json("/api/approvals", {
      method: "PATCH",
      body: { user_id: results.leadId, action: "approve", role: "lead" },
    });
    check("approve lead", a1.status === 200, `got ${a1.status}`);
    const a2 = await admin.json("/api/approvals", {
      method: "PATCH",
      body: { user_id: results.empId, action: "approve", role: "employee" },
    });
    check("approve employee", a2.status === 200, `got ${a2.status}`);

    const ws = await lead.json("/api/workspaces");
    check("lead now has a workspace", ws.status === 200 && ws.body.length === 1, JSON.stringify(ws.body));
    results.workspaceId = ws.body?.[0]?.id;

    const wsEmp = await employee.json("/api/workspaces");
    check("employee joins the same workspace", wsEmp.body?.[0]?.id === results.workspaceId);
  }

  console.log("\n== projects & issues ==");
  {
    const p = await lead.json("/api/projects", {
      method: "POST",
      body: { workspace_id: results.workspaceId, name: "Mongo Migration", key: "MGO" },
    });
    check("create project", p.status === 201, `got ${p.status} ${JSON.stringify(p.body)}`);
    results.projectId = p.body?.id;

    const i = await lead.json("/api/issues", {
      method: "POST",
      body: {
        project_id: results.projectId,
        title: "Store everything in MongoDB",
        description: "Verify the MongoDB backed store",
        priority: "high",
      },
    });
    check("create issue", i.status === 201, `got ${i.status} ${JSON.stringify(i.body)}`);
    results.issueId = i.body?.id;

    const list = await employee.json(`/api/issues?workspace=${results.workspaceId}`);
    check("employee can list workspace issues", list.status === 200 && list.body.length === 1, JSON.stringify(list.body).slice(0, 200));

    const single = await lead.json(`/api/issues/${results.issueId}`);
    check("issue key is derived", single.body?.key === "MGO-1", single.body?.key);
  }

  console.log("\n== assignment & submission ==");
  {
    const assign = await lead.json(`/api/issues/${results.issueId}/assign`, {
      method: "POST",
      body: { user_ids: [results.empId], note: "Please do it" },
    });
    check("lead assigns work", assign.status === 200, `got ${assign.status} ${JSON.stringify(assign.body)}`);
    check("one assignment created", assign.body?.assigned_count === 1);

    const forbidden = await employee.json(`/api/issues/${results.issueId}/assign`, {
      method: "POST",
      body: { user_ids: [results.empId] },
    });
    check("employee cannot assign work (403)", forbidden.status === 403, `got ${forbidden.status}`);

    const mine = await employee.json(`/api/assignments?workspace=${results.workspaceId}&mine=1`);
    check("employee sees the assignment", mine.status === 200 && mine.body.length === 1, JSON.stringify(mine.body).slice(0, 200));
    results.assignmentId = mine.body?.[0]?.id;

    const content = "proof of work from the e2e test";
    const file = Buffer.from(content).toString("base64");
    const submit = await employee.json(`/api/submissions/${results.assignmentId}`, {
      method: "POST",
      body: {
        submission_text: "Done — see the attached file",
        files: [
          {
            filename: "proof.txt",
            content_type: "text/plain",
            data_url: `data:text/plain;base64,${file}`,
          },
        ],
      },
    });
    check("employee submits work", submit.status === 200, `got ${submit.status} ${JSON.stringify(submit.body)}`);
    check("submission has a timestamp", Boolean(submit.body?.submitted_at));

    const issue = await employee.json(`/api/issues/${results.issueId}`);
    const assignment = issue.body?.assignments?.find((a) => a.id === results.assignmentId);
    check("assignment is submitted", assignment?.status === "submitted", assignment?.status);
    check("attachment metadata stored", assignment?.attachments?.length === 1, JSON.stringify(assignment?.attachments));
    results.attachmentId = assignment?.attachments?.[0]?.id;

    // Download the file back and compare the bytes.
    const res = await employee.fetch(`/api/attachments/${results.attachmentId}`);
    const text = await res.text();
    check("attachment downloads", res.status === 200, `got ${res.status}`);
    check("attachment content matches", text === content, JSON.stringify(text.slice(0, 40)));

    const notAllowed = await employee.json(`/api/submissions/${results.assignmentId}`, {
      method: "PATCH",
      body: { action: "approve" },
    });
    check("employee cannot approve own work (403)", notAllowed.status === 403, `got ${notAllowed.status}`);

    const approve = await lead.json(`/api/submissions/${results.assignmentId}`, {
      method: "PATCH",
      body: { action: "approve" },
    });
    check("lead approves work", approve.status === 200, `got ${approve.status}`);

    const afterApprove = await employee.json(`/api/submissions/${results.assignmentId}`, {
      method: "POST",
      body: { submission_text: "resubmitting" },
    });
    check("cannot submit after approval (400)", afterApprove.status === 400, `got ${afterApprove.status}`);
  }

  console.log("\n== notifications, comments, documents, calendar, messages ==");
  {
    const notes = await employee.json("/api/notifications");
    check("employee has notifications", notes.status === 200 && notes.body.notifications.length > 0, `count ${notes.body?.notifications?.length}`);

    const comment = await employee.json(`/api/issues/${results.issueId}/comments`, {
      method: "POST",
      body: { content: "Looks good to me" },
    });
    check("employee comments", comment.status === 201, `got ${comment.status}`);

    const doc = await lead.json("/api/documents", {
      method: "POST",
      body: { workspace_id: results.workspaceId, title: "Runbook", content: "# Runbook\n\nUse MongoDB." },
    });
    check("create document", doc.status === 201, `got ${doc.status} ${JSON.stringify(doc.body)}`);
    const docs = await lead.json(`/api/documents?workspace=${results.workspaceId}`);
    check("document listed", docs.body?.length === 1, JSON.stringify(docs.body).slice(0, 120));

    const event = await lead.json(`/api/calendar?workspace=${results.workspaceId}`, {
      method: "POST",
      body: {
        title: "MongoDB sync",
        start_at: "2026-01-02T10:00:00.000Z",
        end_at: "2026-01-02T11:00:00.000Z",
        notify_user_ids: [results.empId],
      },
    });
    check("create calendar event", event.status === 201, `got ${event.status} ${JSON.stringify(event.body)}`);
    const events = await lead.json(`/api/calendar?workspace=${results.workspaceId}`);
    check("event listed", events.body?.length === 1);

    const convo = await employee.json("/api/conversations", {
      method: "POST",
      body: { workspace_id: results.workspaceId, user_id: results.leadId },
    });
    check("start conversation", convo.status === 200 || convo.status === 201, `got ${convo.status} ${JSON.stringify(convo.body)}`);
    results.conversationId = convo.body?.id;
    const msg = await employee.json(`/api/conversations/${results.conversationId}/messages`, {
      method: "POST",
      body: { body: "Hi lead, the migration is done." },
    });
    check("send message", msg.status === 201, `got ${msg.status}`);
    const thread = await lead.json(`/api/conversations/${results.conversationId}/messages`);
    check("lead sees the message", thread.body?.length === 1, JSON.stringify(thread.body).slice(0, 120));
  }

  console.log("\n== dashboard, search, performance, storage ==");
  {
    const dash = await lead.json(`/api/dashboard?workspace=${results.workspaceId}`);
    check("dashboard metrics", dash.status === 200 && dash.body?.stats, JSON.stringify(dash.body).slice(0, 200));
    check("dashboard counts the issue", dash.body?.stats?.total_issues === 1, JSON.stringify(dash.body?.stats));

    const search = await lead.json(`/api/search?q=Mongo`);
    check(
      "search finds the issue",
      search.status === 200 && (search.body?.issues?.length ?? 0) > 0,
      JSON.stringify(search.body).slice(0, 200)
    );

    const perf = await admin.json(`/api/performance?workspace=${results.workspaceId}`);
    check("admin performance scope", perf.status === 200 && perf.body?.rows?.length >= 3, `rows ${perf.body?.rows?.length}`);

    const storage = await admin.json("/api/admin/storage");
    check("storage report", storage.status === 200 && storage.body?.mode === "mongodb", `got ${storage.status}`);
    check("storage lists collections", (storage.body?.collections?.length ?? 0) >= 17);
    check("storage counts attachments", storage.body?.attachments?.count === 1, JSON.stringify(storage.body?.attachments?.count));
    check("storage counts stored files", storage.body?.attachments?.file_count === 1, JSON.stringify(storage.body?.attachments));
  }

  console.log("\n== data really lives in MongoDB ==");
  {
    const client = new MongoClient(URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const names = (await db.listCollections().toArray()).map((c) => c.name);

    for (const expected of [
      "users",
      "password_credentials",
      "sessions",
      "workspaces",
      "workspace_members",
      "projects",
      "issues",
      "issue_assignments",
      "submission_attachments",
      "attachment_files",
      "comments",
      "documents",
      "calendar_events",
      "conversations",
      "messages",
      "notifications",
      "activities",
    ]) {
      check(`collection "${expected}" exists`, names.includes(expected));
    }

    const users = await db.collection("users").countDocuments();
    check("users stored in mongo", users >= 3, `users=${users}`);
    const issues = await db.collection("issues").countDocuments();
    check("issues stored in mongo", issues >= 1, `issues=${issues}`);
    const files = await db.collection("attachment_files").countDocuments();
    check("file bytes stored in mongo", files === 1, `files=${files}`);
    const doc = await db.collection("attachment_files").findOne({});
    const bytes = doc?.data?.value ? Buffer.from(doc.data.value()) : null;
    check(
      "file bytes are binary",
      bytes !== null && bytes.toString() === "proof of work from the e2e test",
      JSON.stringify(doc?.data?.constructor?.name)
    );

    const raw = await db.collection("issues").findOne({});
    check("documents keep the model shape", raw?.title === "Store everything in MongoDB" && typeof raw._id === "string");
    check("documents carry an order marker", typeof raw?._ord === "number");

    // Newest-first collections must stay newest-first: the order the API
    // returns has to match the order MongoDB yields with a descending sort.
    const acts = await db.collection("activities").find({}).sort({ _ord: -1 }).toArray();
    check("activities are ordered newest first", acts.length >= 1);
    const actOrds = acts.map((a) => a._ord);
    check(
      "activity order numbers descend",
      actOrds.every((ord, i) => i === 0 || ord < actOrds[i - 1]),
      JSON.stringify(actOrds)
    );
    const notifs = await db.collection("notifications").find({}).sort({ _ord: -1 }).toArray();
    const notifOrds = notifs.map((n) => n._ord);
    check(
      "notification order numbers descend",
      notifOrds.length >= 1 && notifOrds.every((ord, i) => i === 0 || ord < notifOrds[i - 1]),
      JSON.stringify(notifOrds)
    );
    // The API has to hand the rows back in exactly that order.
    const apiNotifications = await admin.json("/api/notifications");
    const apiOrder = (apiNotifications.body?.notifications ?? []).map((n) => n.id);
    const apiCreated = (apiNotifications.body?.notifications ?? []).map((n) => n.created_at);
    check(
      "api returns the notifications newest first",
      apiCreated.length > 0 && apiCreated.every((t, i) => i === 0 || t <= apiCreated[i - 1]),
      apiCreated.join(",")
    );
    const adminId = results.adminId;
    const dbOrder = notifs.filter((n) => n.user_id === adminId).map((n) => n.id);
    check(
      "api order matches the stored order",
      apiOrder.length === dbOrder.length && apiOrder.every((id, i) => id === dbOrder[i]),
      `api=${apiOrder.join(",")} db=${dbOrder.join(",")}`
    );

    // The lease must be released after every write.
    const lock = await db.collection("_melouz_locks").findOne({ _id: "db-writer" });
    check("write lease released", lock === null, JSON.stringify(lock));

    await client.close();
  }

  console.log("\n== summary ==");
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("failed checks:\n  - " + failures.join("\n  - "));
  }
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
