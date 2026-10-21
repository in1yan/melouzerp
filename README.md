# MELOUZ OS

Polished project management + ERP inspired by Notion and Plane.so. Runs fully on
localhost with real authentication and durable data in MongoDB.

## Start

```bash
npm install
cp .env.example .env.local      # set MONGODB_URI
npm run dev
# open http://localhost:3000
```

You need a MongoDB server. Either run one locally:

```bash
# Docker
docker run -d --name melouz-mongo -p 27017:27017 mongo:8

# or a local mongod
mongod --dbpath /path/to/data --bind_ip 127.0.0.1
```

or point `MONGODB_URI` at an Atlas cluster. The connection string is the only
required setting.

Sign up as a **lead** or **employee** (pick your role on the sign-up page). New accounts are
**pending** until an admin approves them — you can log in, but you'll see an "awaiting
approval" screen. Approve/reject requests from the **Approvals** tab. Everyone who is
approved joins one shared **company workspace**, so accounts in different browsers see each
other's work. Use the **Performance** tab to see metrics (admins see everyone including
leads; leads see their employees).

**Default admin** (seeded on first run, configurable via env):
`admin@melouz.local` / `admin12345`.

## Architecture

- **Auth** — self-contained, no Supabase. Passwords are hashed with Node `scrypt`
  (`src/lib/auth.ts`). Sessions are random tokens stored in an `httpOnly` cookie
  (`melouz_session`, 30-day TTL) and validated per request.
- **Data** — MongoDB, one collection per entity (users, issues, projects, comments,
  attachments, …). The connection string comes from `MONGODB_URI` (`src/lib/mongo.ts`).
  `src/lib/store.ts` exposes the same `readDB()` / `mutate()` API the rest of the app uses:
  a mutation takes the MongoDB write lease, reloads a fresh snapshot, applies the change and
  writes back only the rows that actually changed. Reads are served from a short lived cache
  and validated against a version counter so a reader never sees a half-written database.
- **Files** — uploaded proof-of-work files are stored as BSON binary in the
  `attachment_files` collection; the metadata lives next to it in `submission_attachments`.
- **API** — REST route handlers under `src/app/api/**` with zod validation
  (`src/lib/api.ts`) and role checks (owner/admin/lead/employee).
- **Route protection** — `src/proxy.ts` (Next.js 16 Proxy, formerly middleware) guards
  `/dashboard` and `/api/*` by cookie presence; a client `401` listener redirects to `/login`.
- **AI assistant** — real provider call via `/api/ai` using an OpenAI-compatible endpoint.
  Without `AI_API_KEY` it returns a 503 setup hint instead of fabricating answers.

## Features

- Workspaces, Projects, Issues, Kanban (drag-and-drop), Calendar, Teams, Documents
- **Roles & approvals** — sign up as lead/employee; an admin approves or rejects requests
  (with a reason) before you join the shared company workspace
- **Performance metrics** — per-member assigned/approved/rejected/completion/avg-approval
  (admins see everyone including leads; leads see their employees)
- **Work assignment & submissions** — admins/leads assign issues to members or groups;
  assignees submit a description, proof-of-work files (PDF/image/text/zip), and code/doc
  attachments with an automatic system-time submission timestamp; reviewers approve or
  request changes; leads, admins, and the assigner are notified on each submission
- **Team calendar** — admins, leads, and employees schedule events with a meeting link,
  reason/agenda, attendees, time (or all-day), location, and visibility
- **Messages** — slide-out chat from the left (sidebar/header icon) to message any
  teammate directly, with unread badges and notifications
- Real command palette (Ctrl/⌘+K) backed by `/api/search`
- Notifications, activity log, dashboard metrics
- Markdown documents with autosave
- Light/dark theme

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string (`mongodb://…` / `mongodb+srv://…`) |
| `MONGODB_DB` | no | Database name — defaults to the name in the URI, else `melouz` |
| `MONGODB_CACHE_TTL_MS` | no | Read cache lifetime in ms (default `1000`) |
| `AI_API_KEY` | no | Enables the AI assistant |
| `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` | no | Seeded admin account |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | no | SMTP credentials for email notifications |
| `SMTP_FROM` | no | Sender address; defaults to `SMTP_USER` |
| `SMTP_SECURE` | no | Set to `1` for implicit TLS, typically with port `465` |

See `.env.example` for the full list.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run migrate:mongodb   # import the legacy JSON store into MongoDB
npm run e2e:mongodb       # end-to-end suite (70 checks) against a running server
npm run e2e:concurrency   # parallel-write / no-lost-update checks
npx tsc --noEmit    # type check
npx eslint          # lint
```

Both e2e scripts refuse to run against a database whose name does not contain
`e2e`, `test` or `ci`, so they can never wipe real data.

## Data & reset

All data lives in the MongoDB database. To reset the app, drop the database
(`mongosh --eval 'db.dropDatabase()'`); the next request re-seeds the default
admin and the company workspace.

Migrating from the old JSON store (`~/.melouz-os/data/db.json`):

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/melouz npm run migrate:mongodb
```

The script reads `MONGODB_URI` from the environment, falling back to
`.env.local` / `.env` in the project root. Use `--dry-run` to preview and
`--force` to import into a database that already holds users.
