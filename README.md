# MELOUZ OS

Polished project management + ERP inspired by Notion and Plane.so. Runs fully on localhost
with real authentication and durable local data — no external services required.

## Start

```bash
npm install
npm run dev
# open http://localhost:3000
```

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
- **Data** — a typed JSON store at `~/.melouz-os/data/db.json` (`src/lib/store.ts`) written
  atomically (temp file + rename). It lives **outside** the project folder on purpose so that
  writes don't trigger Next.js/Turbopack dev recompiles. Override with `MELOUZ_DATA_DIR`.
  Survives server restarts.
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

Everything works with zero configuration. To enable the AI assistant, set `AI_API_KEY`
(and optionally `AI_API_BASE_URL`, `AI_MODEL`) in `.env.local` — see `.env.example`.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npx tsc --noEmit    # type check
npx eslint          # lint
```

## Data & reset

All data lives in `~/.melouz-os/data/db.json` (outside the repo, so writes never trigger
dev recompiles). Delete that file to reset the app. Set `MELOUZ_DATA_DIR` to store it
somewhere else (e.g. inside the repo) if you prefer.
