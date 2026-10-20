# OPENCODE.md — Melouz OS working notes

Running log of the rescue/rebuild of Melouz OS into a fully working, self-contained
Next.js 16 ERP. Keep this file updated as work progresses.

## Objective

- Fix the real app end-to-end (auth, workspaces, projects, issues, Kanban DnD, documents,
  calendar, teams, notifications, search, AI).
- Add work assignment: admins/leads assign an issue to members/groups; assignees submit
  work (description + proof files) with auto system timestamp; reviewers approve/reject.
- Add a team calendar where admins, leads, and employees schedule events (meeting link,
  reason, attendees, time, visibility).
- Remove all fake/demo functionality; make data persist on localhost.
- Verify with typecheck, lint, production build, and HTTP workflow tests.
- Never claim something works without testing it.

## Key decisions

- **Replaced fake Supabase** (placeholder creds, stub client returning success) with:
  - Local auth: `scrypt` password hashing, random session token in an `httpOnly` cookie
    `melouz_session` (30-day TTL). See `src/lib/auth.ts`.
  - Typed JSON store `data/db.json` written atomically (tmp + rename). See `src/lib/store.ts`.
  - Deleted `src/lib/supabase/`, `src/lib/db.ts` (legacy), `src/middleware.ts`, `supabase/`.
- **AI is real-only**: `/api/ai` calls an OpenAI-compatible provider; returns 503 with setup
  instructions when `AI_API_KEY` is absent (no fabricated answers).
- **Next.js 16 specifics used**: `src/proxy.ts` (Proxy, replaces `middleware.ts`), awaited
  dynamic `params`, async `cookies()`.
- **Base UI** (`@base-ui/react`), not Radix: no `asChild`; use `render={<Element />}`.
- **react-hooks/set-state-in-effect** (eslint-plugin-react-hooks v7): data loaders were
  rewritten as promise chains so no `setState` runs synchronously in an effect body;
  workspace active id is seeded from a server-set cookie via props (no effect).

## Structure

- Core libs: `src/lib/{types,store,auth,api,client,domain}.ts`
- API routes: `src/app/api/**` (auth, workspaces, members, projects, issues, comments,
  issues/:id/assign, submissions/:id, assignments, approvals, performance, notifications,
  search, dashboard, documents, calendar, calendar/:id, conversations,
  conversations/:id/messages, ai, profile)
- Shell: `src/app/(dashboard)/layout.tsx`, `src/components/layout/{app-shell,sidebar,header}.tsx`
- Pages: `src/app/(dashboard)/dashboard/{page,workspaces,projects,issues,kanban,calendar,teams,documents,approvals,performance,settings}`
- Providers: `src/components/providers.tsx` (theme + toaster),
  `src/components/providers/workspace-provider.tsx`

## Status

### Done
- Audit of the original codebase (demo data, dead API routes, no-op middleware).
- Data/auth/validation layer + all API routes.
- `src/proxy.ts` route protection; 401 client listener redirects to `/login`.
- Rewrote every page and layout; removed demo data.
- Fixed all TypeScript errors (`npx tsc --noEmit` clean).
- Fixed all ESLint errors and warnings (`npx eslint` clean).
- Production build passes (`npm run build`, exit 0); build reports `ƒ Proxy (Middleware)`.
- E2E HTTP workflow verified against the dev server: signup → me → create workspace →
  create project → create issue → PATCH status to in_progress → reload (persisted) →
  dashboard metrics → search hit → create document → documents list. Data confirmed on
  disk in `data/db.json`.
- Smoke tests: all 9 dashboard routes return HTTP 200 when authenticated.
- Docs/config: `README.md`, `.env.example`, `.gitignore` (`/data/db.json` ignored).

### Work assignment & submissions (feature 1)
- New types: `IssueAssignment`, `SubmissionAttachment` (+ `issue_assignments`,
  `submission_attachments` in `DB`/`EMPTY_DB`).
- API:
  - `POST /api/issues/:id/assign` — bulk-assign an issue to members (workspace admin or
    project lead only; 403 otherwise). Body `{ user_ids[], note?, due_date? }`.
  - `POST /api/submissions/:id` — assignee submits work: `{ submission_text?, files[] }`;
    sets `status="submitted"` and `submitted_at=nowISO()`. Blocked once approved.
  - `PATCH /api/submissions/:id` — reviewer `{ action: "approve" | "reject", rejection_reason? }`.
  - `GET /api/assignments?workspace=|issue=|mine=1` — assignment feed with issue/project/
    assignee/assigner/attachments.
  - `GET /api/issues/:id` now also returns `assignments[]` (with attachments).
  - File uploads are base64 data URLs (pdf/image/txt/md/zip/doc, ≤10 MB each, up to N files).
- UI: `src/components/issues/assign-work-dialog.tsx` (member multi-select, note, deadline),
  `src/components/issues/assignment-panel.tsx` (submit form + file upload, auto submission
  timestamp, status badges, reviewer approve / request-changes), wired into
  `issue-dialog.tsx` (Assign button + "Assigned work" section).

### Calendar events (feature 2)
- New type `CalendarEvent` (+ `calendar_events` in `DB`/`EMPTY_DB`).
- API: `GET/POST /api/calendar?workspace=`, `PATCH/DELETE /api/calendar/:id`
  (edit/delete restricted to the organizer or a non-`member`-role user). Events carry
  title, description/reason, start/end, all-day, location, meeting link, attendees
  (validated as workspace members), visibility, color.
- UI: `src/components/calendar/event-dialog.tsx` (create/edit/delete) and a rebuilt
  `dashboard/calendar/page.tsx` — month grid mixing events (violet) and issue due-dates,
  hover "+" to add an event or issue on a day, event detail dialog with join link and
  attendee list.

### Verified E2E (assignments + calendar)
- Single-command dev-server run + HTTP script; **24/24 checks passed**:
  signup×3 → workspace → invite admin/member → project → issue → assign (owner) →
  employee sees assignment → submit with attachment (auto timestamp) → issue shows
  submitted + attachment + timestamp → reject → employee sees rejected → resubmit →
  lead approves → cannot submit after approval (400) → member cannot assign (403) →
  create event → list → patch → non-organizer member cannot edit (403) → lead deletes.
- Persistence confirmed in `data/db.json` (`issue_assignments`, `submission_attachments`,
  `calendar_events`).

### Direct messages (feature 3)
- New types `Conversation` and `Message` (+ `conversations`, `messages` in `DB`/`EMPTY_DB`).
- API: `GET/POST /api/conversations?workspace=` (list enriched with participants,
  last message, unread; POST finds-or-creates a 1:1 conversation with a workspace member),
  `GET/POST /api/conversations/:id/messages` (`?mark_read=1` marks read; POST notifies the
  other participant).
- UI: `src/components/shared/messages-drawer.tsx` — left slide-out (`Sheet side="left"`)
  opened via the `melouz:open-messages` window event from a **Messages** launcher in the
  sidebar and a message icon in the header. Shows conversation list with unread badges,
  a teammate picker, and a live thread (8s polling, Enter to send).

### Bug fix — profile/settings page
- `dashboard/settings/page.tsx` called `setState` during render (`if (workspace &&
  wsLoaded !== workspace.id) { setWsLoaded(...); … }`), causing the render error when the
  page was opened. Extracted the workspace form into a `WorkspaceSettings` child component
  keyed by `workspace.id`, seeding initial state from props (no render-phase setState).

### Verified E2E (messaging + settings)
- **17/17 checks passed**: signup×2 → workspace → invite → start conversation →
  idempotent reopen → send → recipient sees unread → read clears unread → reply →
  ordering → notification on reply → settings page 200 + renders profile form → calendar 200.
- Persistence confirmed in `data/db.json` (`conversations`, `messages`).

### Roles, approvals & shared company workspace (feature 4)
- `Role` is now `"owner" | "admin" | "lead" | "employee"` (`member` removed). Helpers in
  `src/lib/auth.ts`: `isAdminRole`, `isLeadRole`, `isSuperiorRole` (lead/admin/owner).
  All former `role === "member"` gates became `!isSuperiorRole(...)`.
- **Seeded admin**: `src/lib/bootstrap.ts` `ensureBootstrap()` (called from
  `(dashboard)/layout.tsx`, login, approvals) seeds one default admin
  (`DEFAULT_ADMIN_EMAIL`/`DEFAULT_ADMIN_PASSWORD`, default `admin@melouz.local` /
  `admin12345`) as `owner` of the single **company workspace** (`is_company: true`,
  `COMPANY_WORKSPACE_NAME`). Store `load()` migrates legacy users/workspaces
  (backfills `requested_role`, `approval_status`, `is_company`, etc.).
- **Join flow**: `/signup` asks for name/email/password + a **lead/employee** selector (no
  workspace name). New users are created `approval_status: "pending"`, own **no** workspace,
  and are notified to the admin. They can log in but only see the "awaiting approval" screen.
- **Approvals**: `GET/PATCH /api/approvals` (admin-only) lists pending + recent users and
  approves (assigning `lead`/`employee`) or rejects (with reason). Approving adds the user to
  the company workspace so **accounts in different browsers see each other**; both parties are
  notified. UI: `/dashboard/approvals` (sidebar "Approvals", admin-only).
- **Rejected users** get a rejected screen (with reason), not a redirect — a redirect would
  loop because the session cookie is still valid and the proxy bounces back to `/dashboard`.
- Login returns `approval_status`; rejected accounts get a 403 on login.

### Performance metrics (feature 5)
- `GET /api/performance?workspace=` — admins/owners see **all** rows (including leads);
  leads see **their employees** + themselves; employees see only themselves.
- Per member: assigned, pending, in review, approved, rejected, completion rate, avg
  approval time. UI: `/dashboard/performance` (sidebar "Performance").

### Submission notifications (feature 6)
- On submit, the assigner **and** all workspace leads/admins are notified (submitter
  excluded) + an activity is logged. On review, the assignee is notified of approval or
  rejection (with reason).

### Verified E2E (roles + approvals + performance)
- **30/30 checks passed**: seeded admin login → signup lead/employee (pending) → pending user
  logs in but has no workspace → admin sees both pending with requested roles → approves →
  both join the shared company workspace → members see each other → lead creates
  project/issue → lead assigns → employee submits → lead + admin notified → lead approves →
  employee notified → admin performance scope `all` (lead + employee rows, employee 100%
  completion) → lead performance scope `employees` (only employees + self) → employee cannot
  approve (403) → reject flow → employee notified of changes requested.
- Persistence confirmed in `data/db.json`.

### Bug fix — blank page on sign in / register (infinite redirect loop)
- Symptom: clicking sign in/register left a blank page with the dev "rendering" widget
  spinning forever.
- Cause: an **invalid / stale `melouz_session` cookie** (expired session, or a session whose
  user was removed — e.g. after deleting/regenerating `data/db.json`). `proxy.ts` only checks
  cookie *presence*, so `/dashboard` (layout finds no valid user) → `/login`, and `/login`
  (proxy sees a cookie) → `/dashboard` → **endless loop → blank page**.
- Fix: the dashboard layout now redirects to `/login?stale=1` when the cookie is present but
  invalid; the proxy sees `stale=1`, **clears the cookie**, and lets `/login` render. Verified
  in a real headless Chromium browser: a bogus cookie now settles on the Sign in page.
- Also added `src/app/global-error.tsx` and `src/app/(dashboard)/error.tsx` so any render
  error shows a recoverable message instead of a blank screen.
- Verified in headless Chromium (CDP): home → sign-in link → login → signup → pending screen
  → refresh status → sign out → admin login → dashboard (sidebar) → Approvals → Performance,
  with **zero console errors**.

### Notes / follow-ups
- `data/db.json` is git-ignored; delete it to reset.
- Issue `key` is derived (`issueKey()`), not stored on the row — do not expect `key` on
  raw DB issue records.
- Dev server should be run and exercised within a single shell invocation (a background
  `Start-Job` + the test script), because detached processes do not survive between tool
  calls. Restart it after changing `src/proxy.ts`.

### Permissions, tracking, notifications & dev-recompile fix (round 2)

- **Delete permissions tightened**
  - Issues (`DELETE /api/issues/:id`): only the **reporter** (creator) or an **admin**
    (`isAdminRole`) may delete — leads/assignees can no longer delete. UI hides the trash
    button in `issue-dialog.tsx` unless `reporter.id === user.id || role ∈ {admin,owner}`.
  - Assigned work: new `DELETE /api/assignments/:id` — only the **assigner** (`assigned_by`)
    or an **admin** may remove an assignment (deletes its attachments too). The assignee
    cannot. UI shows the trash button only for the assigner or admins (`assignment-panel.tsx`
    now takes a `canDelete` prop; per-item check `assigned_by === currentUserId`).
- **Per-person tracking**: `IssueAssignment` gained `submit_count` / `resubmit_count`
  (migrated in `store.ts load()`), incremented on submit/resubmit in
  `/api/submissions/:id`. `GET /api/performance` rows now include `submit_count`,
  `resubmit_count`, `created_issues`, `raised[]` (issues raised) and `works[]` (assigned
  work with counters + last submission + rejection reason). Performance page adds Raised /
  Submits / Resubmits columns and a click-through detail dialog.
- **Cross-user "Compiling…"/re-render fix**: the JSON store lived in `./data/db.json`
  **inside the project tree**, so every mutation triggered a Turbopack dev recompile → the
  overlay + re-render appeared for **all** connected users. The store now lives **outside**
  the project: `~/.melouz-os/data/db.json` (override with `MELOUZ_DATA_DIR`), with a one-time
  copy from the legacy `./data/db.json` if present. No more dev rebuilds on writes.
- **Calendar notify picker**: `POST /api/calendar` and `PATCH /api/calendar/:id` accept
  `notify_all` or `notify_user_ids[]`; notifications are sent **only** to those members
  (organizer excluded) with a link to the calendar. `event-dialog.tsx` adds a "Notify"
  section (All members checkbox + searchable member checklist). Also logs a `calendar.created`
  / `calendar.updated` activity. New `Activity.entity_type` value `calendar_event`.
- **Verified E2E (permissions + tracking + calendar notify): 35/35** — issue delete
  (creator/admin only), assignment delete (assigner/admin only), submit/resubmit counters,
  performance tracking arrays, targeted vs all-members calendar notifications.
- **E2E helpers**: `roles-e2e.mjs` (30/30) and `features-e2e.mjs` (35/35) under
  `%TEMP%\opencode`.

### Bug fix — Base UI `MenuGroupContext is missing` (notification bell)
- `DropdownMenuLabel` was built on Base UI's `MenuGroupLabel`, which requires a
  `Menu.Group`/`RadioGroup` parent; using it standalone (notification header, account menu)
  threw `Base UI: MenuGroupContext is missing`.
- Fix: `DropdownMenuLabel` (`src/components/ui/dropdown-menu.tsx`) now renders a plain
  styled `<div>`; `header.tsx` notification header uses a `<span>` and the account-menu
  label is wrapped in `DropdownMenuGroup`. Verified in headless Chromium: bell + account
  menus open with **zero console errors**.

## Verification commands

```bash
npx tsc --noEmit
npx eslint
npm run build
```
