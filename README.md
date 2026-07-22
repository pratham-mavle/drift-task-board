# Drift — Kanban task board

Drift is a polished, responsive Kanban workspace built with React, TypeScript, Supabase, and dnd-kit. It pairs a calm editorial interface with the collaboration features a small team expects: private guest workspaces, assignments, comments, activity history, labels, due dates, filters, and realtime updates.

- **Live demo:** publishing in progress
- **Public repository:** https://github.com/pratham-mavle/drift-task-board

## Highlights

- Four persistent workflow columns: To Do, In Progress, In Review, and Done
- Pointer, touch, and keyboard-friendly drag and drop with optimistic updates
- Automatic Supabase anonymous sign-in; no email or password required
- Strict Row Level Security so every guest can access only their own records
- Task creation, editing, deletion, priority, descriptions, due dates, and ordering
- Lightweight team members with color avatars and many-to-many assignments
- Reusable labels with board-level filtering
- Chronological comments and append-only, trigger-generated activity history
- Search plus priority, assignee, and label filters
- Total, completed, and overdue board statistics
- Intentional loading, empty, filtered-empty, reconnecting, and error states
- Responsive horizontal board on mobile with full-screen task details
- Realtime refresh through Supabase Postgres Changes

## Stack

- React 19 + TypeScript
- Next-compatible App Router through Vinext/Vite
- Supabase Auth, Postgres, Realtime, and RLS
- dnd-kit for accessible drag and drop
- Lucide for interface icons
- Cloudflare-compatible production output

The browser talks directly to Supabase with the public anon key. No custom API or service-role key is needed.

## Run locally

Prerequisites: Node.js 22.13 or newer and a free Supabase project.

```bash
git clone https://github.com/pratham-mavle/drift-task-board.git
cd drift-task-board
npm install
cp .env.example .env.local
```

In Supabase:

1. Open **SQL Editor**, paste the complete contents of `supabase/schema.sql`, and run it once.
2. Open **Authentication → Providers → Anonymous Sign-Ins** and enable anonymous users.
3. Open **Project Settings → API** and copy the Project URL and public anon/publishable key.
4. Put those two public values in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
```

Then start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

If the two public Supabase values are absent, Drift intentionally starts in a clearly labeled demo workspace. Demo changes persist only in that browser. Add `?demo=1` to explicitly preview that mode even when Supabase is configured. A live Supabase error never silently falls back to local data.

## Validate

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` creates a production build, renders the worker response, verifies branded metadata and loading state, and checks the presence of every RLS-protected table and core collaboration capability.

## Database and security

The full executable schema is in [`supabase/schema.sql`](supabase/schema.sql). It creates:

- `tasks`
- `team_members`
- `task_assignees`
- `comments`
- `labels`
- `task_labels`
- `activity_logs`

Every owned and relationship table carries `user_id`. Composite foreign keys and validation triggers prevent cross-owner task/member/label relationships even outside the UI. RLS policies compare `user_id` with `auth.uid()`. Unauthenticated `anon` table privileges are revoked; a signed-in anonymous Supabase user receives the `authenticated` database role and only its matching policies.

Activity is append-only for browser clients. Database triggers authoritatively record task creation, edits, status moves, assignments, labels, and comments. The client receives only `SELECT` access to activity history.

Only the public anon key belongs in the frontend. Never add a Supabase service-role key to `.env.local`, hosting configuration, source code, or Git history.

## Project structure

```text
app/
  components/BoardApp.tsx      workspace state, auth, persistence, filters, DnD
  components/TaskCard.tsx      sortable task card and avatar primitives
  components/TaskPanels.tsx    create/edit/comment/team/label dialogs
  globals.css                  visual system and responsive behavior
lib/
  board.ts                     domain types, demo fixtures, date/activity helpers
  supabase.ts                  safe public Supabase client bootstrap
supabase/
  schema.sql                   tables, indexes, triggers, grants, RLS, realtime
tests/
  rendered-html.test.mjs       production rendering and security contract checks
```

## Deployment

Build with `npm run build`, then deploy the generated Cloudflare-compatible output through Sites. In the hosting dashboard, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as build/runtime environment values. Do not add a service-role key.

## Tradeoffs and next steps

- Team members are lightweight profiles owned by one guest workspace, not separate invited auth identities. A next version would add durable organizations and invitations.
- Drag operations update the affected card positions optimistically and then persist them. At much larger scale, fractional ranking or a dedicated reorder RPC would reduce write volume.
- Comments are intentionally plain text. Mentions, attachments, rich text, and notification delivery are natural extensions.
- The first version has one board per guest. A `boards` table and workspace membership model would support multiple projects.
- Automated checks cover compilation, linting, server rendering, and the schema contract. Full end-to-end multi-browser RLS and drag testing would be the next QA layer.

## License

Created as a portfolio task-manager project. All secrets and private Supabase credentials are intentionally excluded from source control.
