# Stockkart HQ

A small, private work tracker and knowledge base for the Stockkart team: issues, docs,
ADRs and diagrams in one place, linked together. See [SPEC.md](SPEC.md) for the full product
and technical spec.

**The code is public; the data is private.** Every page and API route requires a session,
and only Stockkart accounts with the `SUPER_USER` role can sign in.

Status: **Phase 1 MVP** (slices 1–3: issues, planning, docs). Sign-in, sessions, default-deny
routing, rate limiting and the app shell; issues (list with filters, quick create (`C`),
issue detail with comments, activity, links, linked docs and subtasks); planning (a ranked
backlog with drag and drop, a board, My Work with recently viewed issues, personal todos that
can be promoted to issues, and a ⌘K palette that searches issues, docs and comments); and
docs: a page tree with drag and drop, docs from 13 built-in templates, an autosaving editor
with optimistic locking, tables, callouts and Mermaid diagrams, ADRs with numbering and a
log, and a one-time handbook import. Sprints (SPR-1…4) are in too: sprint sections on the
backlog with Start/Complete, a board scoped to the active sprint, and a sprints page with a
burndown and velocity reconstructed from the activity log. The database schema covers all of
Phase 1 and Phase 2 (migrations 0000–0005).

**P2 status** (all four slices merged): the roadmap (RDM-1/2) shows the epics on a timeline
with their progress and `blocks` dependencies; board columns can have a WIP limit (BRD-5),
issues can be cloned or converted (ISS-14), and completing a sprint can make its retro doc
(SPR-5). Releases (REL-1/2) track fix versions and generate release notes, and project
settings import issues from CSV (IMP-4). Incidents (INC-1/2) have a timeline, follow-up
issues and postmortems, next to a service registry (SVC-1). Docs take page-level and inline
comment threads (DOC-11/13), and an opt-in email digest of unread notifications goes out
through Resend (NTF-2, below). Every sidebar section is built; an unknown project section is
a 404.

## Stack

| Layer     | Choice                                                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict)                                  |
| Auth      | Auth.js (`next-auth` 5 beta) Credentials provider → Stockkart backend (`inventory-api`) |
| DB        | Neon Postgres, Drizzle ORM, `@neondatabase/serverless` (HTTP driver)                    |
| UI        | Tailwind CSS 4, shadcn/ui components, lucide-react                                      |
| Editor    | Tiptap 3 (MIT packages only), loaded client-only                                        |
| Planning  | dnd-kit (MIT) for backlog and board drag and drop                                       |
| Charts    | Recharts (MIT, client-only) for the burndown and velocity charts                        |
| Diagrams  | Mermaid (MIT, strict mode, client-only) with DOMPurify (Apache-2.0 option) on its SVG   |
| Import    | markdown-it (MIT) for the handbook import                                               |
| Tests     | Vitest + Testing Library (unit), Playwright (smoke)                                     |
| Tooling   | pnpm (via corepack), ESLint, Prettier, Husky + lint-staged                              |
| Hosting   | Vercel (Hobby), GitHub Actions CI                                                       |

All dependency versions are pinned exactly.

## How sign-in works

1. The login form posts to a server action. The server reserves the attempt against the
   rate limit (5 failed attempts per email and 20 per IP per 15 minutes, stored in
   `login_attempts`; IPv6 is bucketed per /64) atomically, before calling inventory-api.
2. The HQ server calls `POST {STOCKKART_API_URL}/api/v1/auth/login`. This is
   server-to-server, so the browser never sees the Stockkart token.
3. Only `user.role === "SUPER_USER"` gets in. Any other role sees "Access denied", and HQ
   calls `/auth/logout` to drop the token it was just issued.
4. HQ upserts the `users` row (keyed by the Stockkart `userId`) and issues an Auth.js
   session: an encrypted JWT in an httpOnly cookie that holds the Stockkart token. The
   session ends no later than the 7-day Stockkart token.
5. About once an hour the proxy re-checks `GET /api/v1/auth/me` and the user's
   `session_version`. A 401/403, a role change or a newer `session_version` ends the session.
   A 5xx or timeout keeps it, so HQ still works while inventory-api is down, but a session
   that could not be re-checked for 24 hours ends.
6. Sign-out ends the HQ session and calls `/auth/logout`.

`src/proxy.ts` (Next.js 16's name for `middleware.ts`) denies every route without a session
except `/login`, `/api/auth/*`, `/api/webhooks/github` (authenticated by its HMAC signature
instead, see "GitHub integration") and static
build assets. Pages redirect to `/login`; API routes get `401`. Server code re-checks with
`requireSession()`.

## Local setup

Requirements: Node.js ≥ 20.19 (see `.nvmrc`) with corepack, which ships with Node.

```bash
corepack enable          # makes `pnpm` use the version pinned in package.json
pnpm install
cp .env.example .env.local
# fill in .env.local (see below)
pnpm db:migrate          # needs DATABASE_URL in your shell, see "Database"
pnpm db:seed             # STK project, components, workflow, templates (re-runnable)
pnpm dev                 # http://127.0.0.1:3000 (bound to localhost only)
```

To sign in locally you need a reachable inventory-api with a `SUPER_USER` account, for
example a local backend at `http://localhost:8080`.

### Environment variables

Names only; values never go in the repo. `.env*` files are git-ignored except
`.env.example`. The app validates its environment at startup and **refuses to start** if a
required variable is missing or malformed. Without `STOCKKART_API_URL` or `AUTH_SECRET`
nobody can sign in.

| Name                                                                     | Required | Purpose                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | yes      | Neon Postgres connection string (`postgres://…?sslmode=require`)                                                                                                                                                     |
| `STOCKKART_API_URL`                                                      | yes      | inventory-api base URL **without** `/api/v1`. Must be https (http only for localhost)                                                                                                                                |
| `AUTH_SECRET`                                                            | yes      | Auth.js encryption secret, ≥ 32 random bytes                                                                                                                                                                         |
| `AUTH_URL`                                                               | no       | Public URL of the app. Not needed on Vercel. Set it for `next start` elsewhere, and leave it unset rather than empty                                                                                                 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | no       | Private Cloudflare R2 bucket for attachments and diagram thumbnails (see "File storage (R2)"). Unset or incomplete: the app runs, file routes answer 503 and uploads are refused. Backups use GitHub secrets instead |
| `GITHUB_WEBHOOK_SECRET`                                                  | no       | GitHub webhook HMAC secret (`openssl rand -hex 32`). Unset: the app runs, the webhook answers 503 and does nothing                                                                                                   |
| `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`  | no       | Engineering handbook sync (DOC-14) GitHub App; see "Engineering handbook sync". All three or none: until each is set, publish and pull refuse with "Handbook sync isn't set up". The PEM key may use literal `\n`    |
| `HANDBOOK_REPO`                                                          | no       | `Owner/repo` of the handbook (default `Stockkart/engineering-handbook`; must be in the Stockkart org). The only repo the App client can address                                                                      |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_BASE_URL`                    | no       | Email digest (NTF-2) through Resend; see "Email digest". All three or none: until each is set no email is sent and the profile says "Email isn't set up"                                                             |
| `CRON_SECRET`                                                            | no       | Bearer secret of the cron jobs (`openssl rand -hex 32`, ≥ 32 characters): the digest and the COST-7 monthly reminder. Unset: `/api/cron/digest` and `/api/cron/monthly` answer 503 and do nothing                    |
| `HQ_LOG_QUERIES`                                                         | no       | `1` logs every database round trip per request (counts and ms only, never SQL). Off by default; see "Performance"                                                                                                    |

Generate `AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

### Scripts

| Command                                            | What it does                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                         | Dev server on 127.0.0.1:3000                                                                                                                         |
| `pnpm build` / `pnpm start`                        | Production build / serve on 127.0.0.1                                                                                                                |
| `pnpm local:prod`                                  | Build, then serve the production build on http://127.0.0.1:3001 (the fast way to use HQ locally; see "Performance")                                  |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Static checks                                                                                                                                        |
| `pnpm test`                                        | Unit tests (Vitest). Never touch the network: fetch and the DB are faked. DB-backed suites are skipped unless `HQ_DB_TESTS=1` (see "Database tests") |
| `pnpm test:e2e`                                    | Playwright smoke tests against a production build (run `pnpm build` first; first time: `pnpm playwright install chromium`)                           |
| `pnpm db:generate`                                 | Generate a SQL migration from `src/server/db/schema.ts` into `drizzle/`                                                                              |
| `pnpm db:migrate`                                  | Apply migrations to `DATABASE_URL`                                                                                                                   |
| `pnpm db:seed`                                     | Create the STK project, its components, the default workflow and built-in templates in `DATABASE_URL` (idempotent)                                   |
| `pnpm import:handbook -- --dir <path>`             | Import an engineering-handbook checkout into `DATABASE_URL` as docs and ADRs (idempotent; `--dry-run` writes nothing). See "Importing the handbook"  |
| `pnpm purge:pending-uploads`                       | Delete uploads never confirmed within 24 h (R2 object, then row) from `DATABASE_URL` + `R2_*` in the shell. See "File storage (R2)"                  |

## Database (Neon)

1. Create a Neon project (Postgres 17) in the region nearest your Vercel functions.
2. Create two branches: `main` (production) and `dev` (local development and previews,
   no real data).
3. Copy each branch's **pooled** connection string. Use the `dev` one in `.env.local`.
4. Apply migrations, then seed. The URL is read from your shell, so it never lands in a file:

   ```bash
   DATABASE_URL='postgres://…' pnpm db:migrate
   DATABASE_URL='postgres://…' pnpm db:seed
   ```

   The seed creates project **STK** ("Stockkart"), the components `inventory-api`,
   `inventory-platform`, `infra`, `loadtest` and `hq` (mapped to their `Stockkart/…` repos),
   the §4.4 statuses (Triage is the default for bugs, Backlog for everything else) and the
   §6.2 issue templates. It holds no user data and is safe to re-run: existing rows are kept,
   and only the built-in templates are refreshed. It uses a plain Postgres connection
   (`pg`), which Neon accepts with `sslmode=require`; any non-loopback URL without TLS is
   refused.

Schema changes: edit `src/server/db/schema.ts`, run `pnpm db:generate --name <change>`,
review and commit the SQL in `drizzle/`, then migrate `dev` before `main`.

Migration `0005_p2_foundation` adds the P2 tables up front: `services` (service registry,
no secrets), `incidents` with `incident_services` and `incident_timeline`,
`email_deliveries` (digest idempotency) and `imports` (CSV import history; the file itself
is not stored), plus inline-comment columns on `comments`, `statuses.wip_limit`,
`sprints.retro_doc_id`, `projects.auto_retro` / `incident_counter`, release
`description` / `released_at`, and the digest settings on `users`. AGENTS.md
("P2 slice notes") lists what each P2 slice owns.

Migration `0006_handbook_foundation` adds the schema of the handbook two-way sync
(DOC-12/14) up front: on `docs` the override `handbook_path` (repo path; `source_path` stays
the import origin), `handbook_blob_sha` / `handbook_synced_version` / `handbook_synced_at`
(the file's git blob, the doc version and the time at the last sync; set together) and
`handbook_remote_sha` / `handbook_remote_seen_at` (the latest blob seen on the repo's
default branch), with CHECKs for the sha (40 lower-case hex) and path formats and one live
doc per repo file; plus `handbook_publications` (one PR HQ opened: `hq/…` branch, PR
number/URL, state `open|merged|closed|failed`, `merged_at`, `error_code`) and
`handbook_publication_docs` (publication, doc, path, doc version, blob sha). A doc is in at
most one open publication; AGENTS.md ("Handbook slice notes") explains how, and what the two
handbook slices own.

### Database tests

Some tests (issue number allocation under concurrency, activity rows, `resolved_at`, parent
rules, links, comments, the seed) need a real Postgres because the guarantees live in SQL.
They run only when `HQ_DB_TESTS=1` and `HQ_TEST_DATABASE_URL` points at a **loopback**,
throwaway server (anything else is refused). CI runs them in the `db-tests` job against a
`services: postgres` container. Locally:

```bash
docker run -d --name hq-test-pg -e POSTGRES_USER=hq -e POSTGRES_PASSWORD=hq-local-only \
  -p 127.0.0.1:55432:5432 postgres:17
HQ_DB_TESTS=1 HQ_TEST_DATABASE_URL='postgres://hq:hq-local-only@127.0.0.1:55432/hq' pnpm test
docker stop hq-test-pg && docker rm hq-test-pg
```

The global setup migrates a template database once and every test file runs in its own copy,
so files run in parallel. Never point these variables at a Neon branch.

## Importing the handbook

HQ is the source of truth for docs and ADRs after a one-time import of `engineering-handbook`
(IMP-1…3). Run it locally, after the seed, against the database you want to fill:

```bash
DATABASE_URL='postgres://…' pnpm import:handbook -- --dir ../engineering-handbook --dry-run
DATABASE_URL='postgres://…' pnpm import:handbook -- --dir ../engineering-handbook
# or, reading DATABASE_URL from a local .env file (not shell-sourced):
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/import-handbook.ts --dir ../engineering-handbook
```

Top-level `*.md` files become docs under a "Handbook" page (README → page, ARCHITECTURE →
design, API_CONTRACT → api_contract, RUNBOOK → runbook, REVIEW_RUBRIC → page,
IN_MEMORY_STATE → design) and `decisions/NNNN-*.md` become ADRs under "Decisions", with the
number and title from the file and the status from its `## Status` section ("Superseded by
NNNN" links the two ADRs). `0000-template.md` is skipped. Mermaid fences become Mermaid
blocks. Re-running it updates changed files in place (new version and snapshot) and leaves
the rest alone; docs moved or deleted in HQ stay where they are, and docs edited in HQ since
the import are skipped (HQ is the source of truth) unless you pass `--force`. "New ADR"
continues after the highest imported number.

**The imported content never goes into this repo** (S-7): the script writes only to the
database, and the tests use small synthetic markdown.

## Markdown export (DOC-12)

`GET /<KEY>/docs/<id>/export` downloads a doc as its handbook file (`text/markdown`,
`attachment`, `no-store`, session required; 404 for a missing or deleted doc). The same
code writes the files the handbook publish (DOC-14) puts in its PRs. On the doc page the
"⋯" menu offers "Download as Markdown" (this route) and "Copy as Markdown" (the same
serializer, run in the browser on the copy on screen).

**Doc page** (docs UX): docs and ADRs open read-only (no editor loaded); "Edit" (`E`) or
`?edit=1` switches to editing, "Done" (Esc, ⌘/Ctrl+Enter) saves and goes back. The page tree
is a "Pages" drawer (`[`), pinnable as a narrow column; the side panels (comments, linked
issues, attachments, history, details) open one at a time. History shows a diff of each kept
version against the current one (or the previous one) and restores a version as a new one
(DOC-10); an ADR's menu can supersede it with a new ADR (ADR-3). The header shows the
handbook sync status next to the breadcrumb, and the "⋯" menu has "Publish to handbook" and
"Review & pull" (see "Engineering handbook sync"), in read and edit mode alike; restoring a
version or superseding an ADR is a new version, so a synced doc turns "Changed in HQ".

**Serializer** (`src/lib/markdown/from-rich-text.ts`, the inverse of `to-rich-text.ts`):
editor JSON → GitHub-flavoured Markdown, deterministic, ending in exactly one newline.

| Editor                           | Markdown                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| heading 1–3, paragraph           | `#`…`###`, a paragraph (one line; hard breaks are `\` + newline)     |
| bold, italic, strike, code, link | `**…**`, `*…*`, `~~…~~`, `` `…` ``, `[…](href)` (safe hrefs only)    |
| bullet / ordered / task list     | `-`, `1.`, `- [ ]` / `- [x]`, nested by indentation                  |
| blockquote, horizontal rule      | `> …`, `---`                                                         |
| callout (info / warning)         | `> **Note:** …` / `> **Warning:** …` (read back as a callout)        |
| code block, Mermaid              | ` ```lang ` fence (longer if the code has backticks), ` ```mermaid ` |
| table                            | GFM table, first row = header, `\|` escaped                          |
| @mention, `STK-12`               | `@Name`, plain text                                                  |
| image / file attachment          | `[alt](/api/files/<id>)` / `[name](/api/files/<id>)`                 |
| diagram embed                    | `[Diagram: Title](/<KEY>/diagrams/<id>)`                             |
| inline comment anchor            | dropped (the text stays)                                             |

Docs with root-relative links into HQ (`/api/…` attachments, `/<KEY>/…` diagrams, docs,
issues) end with one HTML comment saying those links only work inside HQ; the importer
drops that paragraph again (not the same line inside a code block). ADRs start with
`# NNNN. Title`, and their Status paragraph starts with the status from the columns
(`` `Accepted` ``, `` `Accepted (recorded retrospectively)` ``, `Superseded by
[NNNN](NNNN-slug.md)` …), keeping the rest ("Recorded against …").

Escaping covers CommonMark and GitHub: ``\ ` * [ ] < | ~ $`` always (GitHub reads a single
`~x~` as strikethrough and `$x$` as math), `_` unless inside a word, `&` before an entity,
`#` in headings, and what would start a block at a line start (`# - + = > :` and `1.`);
whitespace at a line's edges is written as `&#32;`. Bare URLs, `#123` and `@name` still
autolink on GitHub (display only).

`markdownToRichText(richTextToMarkdown(doc))` equals `normalizeForMarkdown(doc)` and a second
export is byte-identical (tests, including 3 000 generated cases). Known lossy cases:
soft line breaks (paragraphs come back on one line), heading levels 4–6 (→ 3), empty
paragraphs and a trailing hard break, hard breaks in headings and table cells (→ space),
table cell spans, a header column and non-paragraph blocks in cells (their text), marks on
inline code, bold/italic/strike on whitespace at their edges (moved outside) and, rarely,
emphasis that starts or ends mid-word next to punctuation (dropped, text kept, rather than
emitting Markdown that means something else), mentions/attachments/diagram embeds (become
text and links), comment anchors, unknown nodes (their text), code block languages outside
`[A-Za-z0-9_+#.-]`, a `mermaid` code block (becomes a Mermaid block), ordered lists whose
last number would exceed nine digits (renumbered from 1) and NUL characters (U+FFFD). A
bullet list whose items all start with a literal `[ ] ` and a quote starting with a bold
`Note:` read back as a task list and a callout. An empty task item is written `- [ ]&#32;`,
which HQ reads back as a task but GitHub shows as the text `[ ]`.

**Repo paths** (`src/lib/docs/handbook-path.ts`): `docs.handbook_path` if set, else
`docs.source_path`, else ADRs `decisions/NNNN-<slug>.md` (ASCII kebab title, ≤ 60 chars) and
other docs `<UPPER_SNAKE_TITLE>.md` at the top level (a GitHub-special name such as
`README`, `LICENSE` or `SECURITY` gets `_DOC`). A path must be relative, use ASCII letters,
digits, `_`, `-` and `.` in `/`-separated segments that do not start with `.`, contain no
`..`, end in lower-case `.md` and be at most 200 characters (CHECKed in the database too);
an invalid stored path is skipped. One live doc per file, case-insensitively.

## Performance

HQ talks to Neon over HTTP, so **every database round trip costs a full network round
trip** to the Neon region (about 180 ms warm from far away, 500–650 ms when a new TLS
connection is needed). Page speed is therefore mostly the number of round trips:

- Reads go through `read()` (`src/server/db/read-batch.ts`): the reads one request starts
  together are sent as one `db.batch()`, one HTTP request. Queries take the project by key
  and the issue by number as subqueries (`IdRef`), so a page does not wait for the project
  before loading the rest. Every page is one round trip; keep it that way (no query that
  waits for another query's result, no per-row lookups).
- Mutations re-render only the pages that show what they changed (`actions/refresh.ts`),
  and the UI shows the change optimistically before the server answers.
- Every route has a `loading.tsx`, so a click shows the next page's shell at once.
- The notification bell's unread count is one more query in the app layout's batch, not a
  request of its own; the bell loads its list only when opened. It does not poll, so an
  idle tab never keeps Neon's compute awake. The count is current after a full page load,
  a mutation that refreshes the page, or opening the bell (a client-side navigation keeps
  the layout, and so the old count).

To see the round trips, set `HQ_LOG_QUERIES=1` (e.g. in `.env.development.local`) and
watch the server log: one `[db]` line per round trip with its statement count and the
request's running totals. It logs counts and timings only, never SQL or parameters.

**For daily use, run the production build locally.** `next dev` compiles each route on
its first visit and renders more slowly; a production build was 1.4–1.8× faster per page in our measurements:

```bash
AUTH_URL=http://127.0.0.1:3001 pnpm local:prod   # build, then serve on 127.0.0.1:3001
```

or without a local Node.js, in Docker (loopback only, reads `.env` read-only):

```bash
docker run --rm -it --network host -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -e AUTH_URL=http://127.0.0.1:3001 -v "$PWD:/app" -w /app node:20-bookworm-slim \
  sh -c 'node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001'
```

**Region matters.** Put Neon in the region closest to the users and the hosting, and run
the Vercel functions in the same region as Neon: a function far from its database pays the
distance on every round trip. Neon is in AWS `ap-southeast-1` (Singapore), so `vercel.json`
pins the functions to Vercel's `sin1` (Singapore, `ap-southeast-1`; one region works on
every plan; see [Vercel regions](https://vercel.com/docs/regions) and
[configuring function regions](https://vercel.com/docs/functions/configuring-functions/region),
checked 2026-10-20). If Neon moves, change `regions` with it.

## Board and issue-list views (BRD-6, VW-4)

Each project has default views, set in **Project settings → Views** (one save for both):

- **Board**: the issue types shown (none picked = all types) and the columns shown (a
  checkbox per status, in workflow order). On the board the toolbar has a **Type** filter,
  a **Columns** menu, and, when the view differs from the defaults, **Save as default** and
  **Reset to default**. URL: `?types=task,bug` (`types=all` = every type) and
  `?hide=<statusId>,…` (`hide=none` = no hidden column), next to `scope=all`; a missing
  param means the project default, unknown values are ignored. Cards in hidden columns are
  counted ("N issues in hidden columns · Show"); hidden columns take no drops, but every
  card's **Move to…** still lists all statuses. WIP counts are of the cards a column shows,
  so the type filter narrows them (as the sprint scope does). The board filters the scope's
  issues in the browser (instant toggles), after the page's 1,000-row limit; past it the
  limit notice shows, as before.
- **Issues list**: the default types and the statuses hidden by default. They apply only
  when the URL has no `type`/`status` and no saved view is open (a saved view keeps its
  own filters; any well-formed `view=` id counts, even one you cannot read), and show as
  active chips. **Clear filters** returns to them (with a saved view open: to no filters),
  **Show all** drops them (`?type=all`), **Save as default** stores the current types and
  statuses.

At least one status stays visible on each (the settings and the server refuse otherwise;
a stored set that covers every status shows them all). Deleting a status removes it from
both hidden sets in the delete's own statement. The defaults come with the project query,
and the list applies them inside its one issue query, so both pages stay one round trip.
Changing defaults writes no activity row (settings never do).

## GitHub integration

Branches, pull requests and commits that mention an issue key show in the issue's
**Development** panel, and a merged PR that says "Fixes STK-123" moves the issue to Done
(SPEC §4.15, GH-1…GH-4). It is one **organisation webhook**; HQ holds no GitHub token for
it. (The handbook sync below adds a GitHub App scoped to the handbook repo only.)

### Setup (once, by an org owner)

The webhook needs the deployed **HTTPS** URL; GitHub cannot reach a local `127.0.0.1`.

1. Generate the secret: `openssl rand -hex 32`. Keep it out of files and chat.
2. Vercel → the HQ project → Settings → Environment Variables: add
   `GITHUB_WEBHOOK_SECRET` with that value for **Production**, then redeploy. Until it is
   set, the webhook answers `503` and accepts nothing.
3. GitHub → `Stockkart` organisation → Settings → Webhooks → **Add webhook**:
   - Payload URL: `https://<your-hq-domain>/api/webhooks/github`
   - Content type: `application/json`
   - Secret: the same value as in step 2
   - SSL verification: enabled
   - "Let me select individual events": **Pull requests**, **Pushes**, **Branch or tag
     creation** (untick everything else, including "Issues")
   - Active: ticked → **Add webhook**
4. GitHub sends a `ping` at once. Open the webhook → **Recent Deliveries**: the ping should
   show `200`. Each delivery shows the request, the response code and body (e.g.
   `{"ok":true,"linked":2,...}`), and can be redelivered from there (a redelivery of an
   applied delivery changes nothing). `401` means the secrets differ; `503` means
   `GITHUB_WEBHOOK_SECRET` is not set on that deployment.
5. Each HQ user sets their GitHub username under **Settings → Profile**, so their PRs and
   commits show with their HQ name. Usernames are unique in HQ but not verified against
   GitHub (first come, display only: it never grants access or changes an issue).

### Behaviour

| Event                                                                                             | What HQ does                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Branch created or pushed, PR opened/edited/synchronized, or commit pushed, mentioning `STK-123`   | Links the branch, PR or commit to the issue. No status change                                                                        |
| Any PR state change (opened, draft, ready, closed unmerged, reopened)                             | Updates the linked PR's state. No status change (opening a PR does **not** move the issue to In Review)                              |
| PR merged into the repo's default branch whose title or body says "Closes/Fixes/Resolves STK-123" | Moves each referenced issue to the project's done status ("Done"), unless it is already done; the Activity tab shows it as by GitHub |
| PR merged without a closing keyword, or merged into another branch                                | Links only                                                                                                                           |
| Repository outside the `Stockkart` organisation                                                   | Ignored (`200`, no effect)                                                                                                           |
| PRs and commits from before the webhook existed                                                   | Not handled (no backfill)                                                                                                            |

Keys match in any case (`stk-42-oom-ocr` links STK-42), for every project key; unknown keys
are ignored. Closing keywords are `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`,
`resolve`, `resolves`, `resolved`, optionally with a colon, and may list several keys
("Fixes STK-1, STK-2"). A push links at most its first 100 commits.

Security: every delivery must carry a valid `X-Hub-Signature-256` (HMAC-SHA256 of the raw
body, compared in constant time) before anything is parsed; bodies over 1 MB get `413`;
each `X-GitHub-Delivery` is applied once (remembered for 30 days). The delivery id is not
signed, so it only dedupes redeliveries; replays are harmless because every rule is
idempotent on its own (a PR's state never moves back to an older event's, and a merge
closes its issues once). Payloads are validated with Zod, and links must point into the
delivering repository; logs hold the event, delivery id, repository and counts, never the
payload or the secret.

### Local testing

`scripts/send-test-webhook.ts` signs a synthetic delivery with `GITHUB_WEBHOOK_SECRET` from
your shell and posts it to a running HQ (default `http://127.0.0.1:3000`; only https URLs or
plain http to `127.0.0.1`/`localhost` are accepted). Run HQ with the same secret:

```bash
GITHUB_WEBHOOK_SECRET='<same value as the server>' pnpm exec tsx scripts/send-test-webhook.ts \
  --event pr-opened --key STK-1 --pr 7      # also: ping, create, push, pr-merged
```

## Engineering handbook sync

`Stockkart/engineering-handbook` is **public**, and people also change it through their own
pull requests, so the sync (DOC-14) works both ways and never overwrites anything silently:

- **HQ → repo**: "Publish to handbook" (the doc header's "⋯" menu, or "Publish selected" in
  Settings → Handbook, at most 50 docs) opens ONE pull request through a GitHub App: a fresh
  `hq/publish-<yyyymmdd>-<id>` branch with every file in ONE commit. HQ never pushes to the
  default branch or to a branch a person made. It publishes the doc's **saved** version: from
  edit mode the dialog saves pending edits first, and says "Save first" if that save fails;
  a doc saved again after its preview (another tab, a rename) is refused until checked again.
- **Repo → HQ**: the org webhook's pushes to the default branch mark the touched docs; "Review
  & pull" shows the diff and applies the file as a new HQ version. From edit mode it first
  saves and leaves edit mode, so the pulled version shows in read mode.

### Setup (once, by an org owner)

1. GitHub → `Stockkart` organisation → Settings → Developer settings → GitHub Apps → **New
   GitHub App**, owned by the org. Homepage URL: the HQ URL. **Webhook: untick "Active"** (no
   App webhook: the org webhook already delivers the handbook's events).
2. Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**,
   **Metadata: Read-only** (mandatory). Nothing else, no organisation or account permissions.
   "Where can this GitHub App be installed?": Only on this account.
3. Create it, note the **App ID**, then **Generate a private key** (a `.pem` download). Keep
   it out of files, chat and the repo.
4. **Install App** → the Stockkart org → **Only select repositories** →
   `engineering-handbook` only. The installation's URL ends in its **installation ID**
   (`…/settings/installations/<id>`).
5. Vercel → the HQ project → Settings → Environment Variables (Production): `GITHUB_APP_ID`,
   `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` (the whole PEM; one line with
   literal `\n` works) and `HANDBOOK_REPO=Stockkart/engineering-handbook`, then redeploy.
6. Check the org webhook (see "GitHub integration") covers the handbook repo: an org webhook
   covers every repo, with **Pushes** and **Pull requests** selected. Settings → Handbook then
   says "GitHub App configured".

HQ asks GitHub for an installation token scoped to `HANDBOOK_REPO` only, with exactly
`contents: write, pull_requests: write, metadata: read`, keeps it in memory until 5 minutes
before it expires, and refuses any URL outside `/repos/<HANDBOOK_REPO>/` (plus the token
endpoint). Logs hold the request kind and status code only, never the key, the JWT, the token
or file contents. Without all three App values every publish, pull, check and import refuses
with "Handbook sync isn't set up".

### Statuses

| Status              | Meaning                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Not in handbook     | Never published or imported, and not seen in the repo                                                     |
| In sync             | HQ's version is the one last published or pulled, and the repo still has that file                        |
| Changed in HQ       | Edited in HQ since the last sync (`version > handbook_synced_version`): publish it                        |
| Changed in handbook | A push changed the file since the last sync (or an imported doc was never compared): review & pull        |
| Both changed        | Both sides changed since the last sync (or there is no common base): a conflict to resolve                |
| PR open #n          | A publish PR is open (one per doc at most); merging it marks the docs In sync, closing it changes nothing |
| Removed in handbook | The file is gone from the default branch: publish to add it back, or delete the doc                       |

The page shows stored state only; it never calls GitHub. A push marks the doc with "blob
unknown" (or "removed"); the exact blob is read when someone opens "Review & pull" or runs
**Check handbook now** (Settings → Handbook, once a minute per project), which compares every
mapped doc with the default branch in one tree request, marks docs whose export already
matches the repo as In sync, and lists unmapped top-level and `decisions/NNNN-*.md` files under
"New in handbook" with an Import button (the importer's conversion, IMP-1/2).

### Conflict rules

- **Publish** reads each file on the default branch first. Identical → skipped (recorded In
  sync). Changed since the last sync (or present with no sync yet) → refused with "Changed in
  the handbook since your last sync: pull first", unless the person reviewed the diff in the
  publish dialog and ticked "Overwrite", which counts only for the exact blob they saw.
- **Pull** applies only if the file is still the blob the diff showed and the doc is still at
  the version the diff was made from. "Repo ahead" (HQ unchanged since the last sync) is a
  clean pull; "Both changed" asks: **Take handbook version** (a new HQ version; HQ's copy stays
  in the version history) or **Keep HQ version** (publish with overwrite, through a PR).
  ADRs keep their HQ number and take the title and `## Status` (incl. "Superseded by NNNN")
  from the file.
- **Secrets block**: the service-registry heuristic (credential URLs, token prefixes,
  `password=…`, long random strings) runs over every file; a finding blocks the publish with
  no override. Every publish shows: _"The handbook repo is PUBLIC: anything you publish is
  visible to everyone on the internet. Check for internal hosts, customer data, secrets and
  @mention names."_
- A publish that fails half-way is recorded `failed` with a short code; its branch may remain
  on GitHub (the message names it), and the paths it pinned are put back. If its PR was
  opened anyway (a timed-out request), merging it still syncs the docs. HQ never retries
  creating a branch or a PR. HQ's own merge push is recognised by the
  `HQ-Publication: hq/…` trailer line or GitHub's "Merge pull request #n from …/hq/…"
  subject (never a revert), only while that publication is open or merged within the hour,
  and is left to the pull_request event; Check handbook now catches anything it misses.
- A merged PR with more than HQ's one commit (someone pushed to the `hq/…` branch) marks the
  docs synced to HQ's export but the handbook side "blob unknown", so they show "Changed in
  handbook" until reviewed. A push processed before the merge event is kept.
- Re-adding a file removed in the handbook needs the same explicit confirmation as an
  overwrite. Paths GitHub gives a meaning to (`README.md`, `LICENSE.md`, `SECURITY.md` …, and
  `decisions/0000-template.md`) are only written from the single-doc dialog after a
  confirmation; bulk publish leaves them out. The server refuses a publish without the
  "fine for everyone on the internet" acknowledgement, and a pull while the doc's PR is open.

### Troubleshooting

**Test connection** (Settings → Handbook, once a minute per project) asks GitHub for a fresh
installation token and reads the repo's default branch; it writes nothing. It shows ✓ or one
of the reasons below. Publish, pull, Check handbook now and Import show the same reason with
its code (e.g. _"… (installation_token.422)."_), and a failed publication in "Recent
publications" shows it too. A code is `<request>.<HTTP status>` (or `.timeout` / `.network`);
GitHub's error text itself is never shown, logged or stored. Rows from before this change
hold `github_<status>` and read as "GitHub refused a request (HTTP n)". Only the code is
stored, so "Recent publications" shows the general reason of a code (e.g.
`open_pull_request.422` reads "GitHub refused to open the PR" even if the toast said "Nothing
changed").

| Code                                                      | Shown                                                                                                                          | Fix                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installation_token.401`, `bad_private_key`               | The GitHub App private key or App ID is wrong.                                                                                 | Check `GITHUB_APP_ID` against the App's page and `GITHUB_APP_PRIVATE_KEY` (the whole PEM, `\n` for line breaks); generate a new key if unsure, then redeploy.                                                                                                                                                                                  |
| `installation_token.403` / `.404` / `.422`, `token_scope` | The GitHub App can't get access to Stockkart/engineering-handbook …                                                            | Stockkart org → Settings → GitHub Apps → the App → **Configure**: select `engineering-handbook`, and accept any pending permission request (an App permission change waits for an org owner). The App needs Contents: Read and write, Pull requests: Read and write, Metadata: Read. A 404 can also mean a wrong `GITHUB_APP_INSTALLATION_ID`. |
| `get_repo.404`, `get_ref.404`                             | The handbook repo or its default branch wasn't found.                                                                          | Check `HANDBOOK_REPO` and that the repo exists with a default branch.                                                                                                                                                                                                                                                                          |
| `repo_scope`                                              | GitHub answered for another repo …                                                                                             | The repo was renamed or transferred: update `HANDBOOK_REPO`.                                                                                                                                                                                                                                                                                   |
| `create_branch.422`                                       | A branch with this name already exists; try again.                                                                             | Publish again (a new branch name); delete leftover `hq/…` branches on GitHub.                                                                                                                                                                                                                                                                  |
| `open_pull_request.422`                                   | Nothing changed: the handbook already has this content / A PR for this branch is already open / GitHub refused to open the PR. | Nothing to do, or use the open PR; otherwise check the branch on GitHub. Delete the leftover branch the message names.                                                                                                                                                                                                                         |
| `update_ref.422`                                          | The handbook changed while publishing; try again.                                                                              | Publish again.                                                                                                                                                                                                                                                                                                                                 |
| `<request>.429`, `<request>.5xx`                          | GitHub is busy; try again in a minute.                                                                                         | Wait and retry (HQ already retried once, except for creating a branch or a PR). A 403 rate limit reads the same.                                                                                                                                                                                                                               |
| `<request>.timeout`, `<request>.network`                  | GitHub didn't answer / couldn't be reached …                                                                                   | Check githubstatus.com; for a publish, look for the branch or PR it may have made.                                                                                                                                                                                                                                                             |
| anything else, e.g. `get_file.403`                        | GitHub refused the `<request>` request (HTTP n).                                                                               | Check the App's permissions and the server log line `[handbook-github] {"kind":…,"status":…}`.                                                                                                                                                                                                                                                 |

## Email digest (NTF-2)

Opted-in users (Settings → Profile: "Email me a digest", daily or weekly on Mondays) get an
email with their unread notifications since the last digest (up to 50, then "and N more"),
with links into HQ. Nothing is sent when there is nothing new. Off by default. Turning it
on starts the first period at that moment (`last_digest_at`), so the first email never
holds a backlog from before the opt-in; after that `last_digest_at` moves only when a
period is sent or skipped.

**Fail closed.** Until `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `APP_BASE_URL` are all
set, no email is ever sent, the job answers 503 and the profile shows "Email isn't set up".
Choices made meanwhile are kept.

Setup (owner):

1. Create a [Resend](https://resend.com) account and **verify a sending domain** (Resend →
   Domains; add the DNS records it shows). "You must add and verify at least one domain to
   send emails with Resend"; the shared `resend.dev` sender only delivers to the account's
   own address ([domains](https://resend.com/docs/dashboard/domains/introduction),
   [403 on resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain),
   checked 2026-10-22). Verify DKIM too: mail clients only offer one-click unsubscribe on
   DKIM-signed mail (RFC 8058 §4).
2. Create an API key with "Sending access" only. In Vercel (Production), set
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (`Stockkart HQ <hq@mail.your-domain>`, on the
   verified domain) and `APP_BASE_URL` (the public https origin, e.g.
   `https://hq.example.com`, used for every link in the email).
3. Generate `CRON_SECRET` with `openssl rand -hex 32` and set it in Vercel (Production).
   Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` on each run
   ([manage cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs), checked
   2026-10-22).
4. **The digest is disabled for now: `vercel.json` has no digest entry in `crons`** (only
   the COST-7 `/api/cron/monthly` job). To enable it, add
   `{ "path": "/api/cron/digest", "schedule": "0 1 * * *" }` to the `crons` array in
   `vercel.json` and redeploy. That schedules `GET /api/cron/digest` daily at 01:00
   UTC (09:00 in Singapore). Vercel calls cron paths with **GET**, only on production
   deployments, at any time within the scheduled hour on Hobby, and may occasionally call
   twice ([cron jobs](https://vercel.com/docs/cron-jobs),
   [usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), checked
   2026-10-22). Hobby allows daily jobs only.

Run it by hand (same auth; POST works too):

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://hq.example.com/api/cron/digest
```

The answer holds counts only (`due`, `sent`, `skipped`, `failed`, `busy`, `deferred`).

How it stays safe:

- **Once per period.** Each send first claims `(user, digest, period_start)` in
  `email_deliveries` (unique), so overlapping or repeated runs send at most once; the
  Resend call carries an `Idempotency-Key`, times out after 10 s and is retried once on a 5xx.
  A failed send keeps its period and is retried by the next run (weekly ones too, without
  waiting for Monday, once they have sent a first digest); `last_digest_at` only moves on
  sent or skipped. A run stops starting sends after ~35 s (the function allows 60 s); the
  rest wait for their next due run. Logs hold ids, counts and error codes, never addresses
  or content.
- **Unsubscribe.** Every email has a one-click link (`/unsubscribe?token=…`) plus
  `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. The
  token is 32 random bytes; only its sha-256 is stored, and each sent digest replaces it
  (older links stop working; a failed send keeps the previous link valid). `GET /unsubscribe` only asks "Unsubscribe?"; the `POST` from that
  button (or the mail client) turns the digest off. It is rate limited per IP, answers the
  same for unknown tokens and shows nothing about the account.
- `/api/cron/digest` and `/unsubscribe` are the only public paths added (exact paths in
  `access-policy.ts`); each authenticates requests itself. (COST-7 later added
  `/api/cron/monthly`, with the same cron-secret auth.)

**Free tier (approximate; confirm on Resend's pricing page before relying on it).** The
quota docs list 100 emails/day and 3,000/month on the free plan (each recipient counts),
up to 3 verified domains, and 10 API requests per second
([account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits),
checked 2026-10-22; the pricing page itself could not be read, so these numbers are
**unverified** against it). One digest per user per day stays far below that.

## Costs (IMR)

`/STK/costs` (sidebar "Costs", palette "Go to Costs") tracks what running Stockkart costs:
the **IMR** (infrastructure monthly run-rate) and the cash paid each month. SPEC
"Costs (IMR)" (COST-1…COST-9) has the rules; in short:

- **Items** tab: what Stockkart pays for (name, vendor, category, billing cycle
  monthly / yearly / usage, currency INR or USD, optional expected amount, renewal date,
  linked service from the registry, notes). "Add Stockkart defaults" adds DigitalOcean App
  Platform, MongoDB Atlas, Vercel, Neon, Cloudflare R2, the domain, Resend, OpenAI, Gemini,
  AWS Textract, GitHub, Grafana Cloud and Razorpay fees, without amounts, linked to the
  registry's default services where they exist; pressing it again adds nothing. Archive
  an item you stopped paying for (its past months still count); drag or use "Move up/down"
  to reorder. Changing an item's currency applies to new months; saved entries keep their
  own currency and rate.
- **Month** tab (default: this month, `?month=YYYY-MM`, ‹ › to switch): type each item's
  amount inline (Enter or leaving the field saves; Esc reverts), pick actual / estimate /
  no charge, add a note. "Copy last month" pre-fills the missing monthly and usage rows as
  estimates. The top shows **IMR this month** (actuals + estimates, yearly items ÷ 12),
  **cash out this month**, the budget bar (amber when over) and the change vs last month.
  "Show run-rate" spreads yearly items over 12 months in the table.
- **Year** tab: items × months with row and column totals, the year total, the average
  IMR and the highest month, plus a stacked chart by category ("Show table" for the same
  numbers as a table).
- **Settings** tab: base currency (fixed once entries exist), monthly budget, reminder day
  (1–28), reminder recipients (default: the project lead) and a default "1 USD = x INR"
  rate. The rate only pre-fills new entries; each entry stores its own rate, editable on
  the Month tab. **HQ never fetches exchange rates.**
- **Export CSV** on the Month and Year tabs: `GET /STK/costs/export?month=YYYY-MM` or
  `?year=YYYY` (signed-in only, `Cache-Control: no-store`, cells escaped against CSV
  injection).

Money is integer minor units (paise / cents) in `bigint` columns, never floats; FX
conversion and the ÷ 12 run-rate round **half-up**. Amounts are never logged and not in
activity rows (an entry change records only its month and kind). Costs are not in
full-text search.

### Monthly reminder (COST-7)

In the bell only: the reminder sends no email of its own (if the NTF-2 digest is ever
enabled, an unread reminder is listed there like any other bell entry). From the reminder day of each month (Stockkart time,
Asia/Kolkata), if **last month** has expected items without an amount (active monthly and
usage items, and yearly items in their renewal month), each recipient gets one
`cost_reminder` bell entry ("October 2026 costs are not added yet (5 items missing)") that
opens `/STK/costs?month=2026-10`. It is deduplicated per project, month and user
(`cost_reminder:<projectId>:<YYYY-MM>:<userId>`), so it arrives once a month however often
the job runs.

The job is `GET /api/cron/monthly`, scheduled **daily** at 03:00 UTC (08:30 IST) by the
`crons` entry in `vercel.json`; the job itself decides whether a project's reminder day has
come. It authenticates like the digest: **set `CRON_SECRET` in Vercel (Production)**
(`openssl rand -hex 32`, see "Email digest" step 3). Without the secret every call is a
harmless 503 and nothing runs; a wrong secret is a 401. Run it by hand:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://hq.example.com/api/cron/monthly
```

The answer holds counts only (`costReminders.projects`, `costReminders.notified`).

Without the cron (no secret yet, or Vercel skipped a run) nothing is lost: the costs page
shows the same reminder as a banner, and My Work shows it as a card to the recipients, both
computed in those pages' existing batched read (no extra round trip).

## Deploying to Vercel

1. Import the GitHub repo in Vercel (framework preset: Next.js; Vercel runs `pnpm install`
   and `pnpm build` using `packageManager` from package.json).
2. Set the environment variables (`DATABASE_URL`, `STOCKKART_API_URL`, `AUTH_SECRET`) for
   **Production** with the Neon `main` branch. For **Preview**, use the Neon `dev` branch
   and a different `AUTH_SECRET`.
3. Apply migrations to the target Neon branch before deploying a change that needs them.
4. Deploy, then run the anonymous-denial checks below before adding any real content.

> **Not on Vercel?** The login rate limit (AUTH-8) reads the client IP from `x-real-ip` /
> `x-forwarded-for`, which is safe only because Vercel's edge overwrites those headers. On
> any other host (self-hosted `next start`, another proxy or CDN) a client can set them and
> get a fresh IP budget per request. Make the proxy in front of HQ overwrite both headers
> with the real client address, or change `clientIpFrom()` in
> `src/server/auth/rate-limit.ts`, before deploying there.

## File storage (R2)

Attachments (ISS-9, DOC-1 images) and diagram thumbnails (DGM-5) live in a **private**
Cloudflare R2 bucket (S-5), reached through `src/server/storage/` (S3-compatible API,
endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`):

- Uploads go **straight from the browser to R2** with a presigned `PUT` (Vercel function
  bodies are limited to about 4.5 MB). The URL lives 5 minutes and signs the
  `Content-Type` and `Content-Length`, so the client cannot change the type or size.
- Downloads go through `/api/files/[id]` (and `/api/files/thumbnail/diagram/[id]`): the
  route checks the session, then answers `302` to a presigned `GET` valid 5 minutes that
  sets `Content-Type` and `Content-Disposition`. Images show inline; PDFs, text and logs
  download (PDFs may be opened inline); SVG, HTML and other active types always download as
  `application/octet-stream`, so nothing can run script on the R2 origin. 10 MB per file.
- Without all four `R2_*` variables nothing breaks: storage calls fail closed
  (`StorageNotConfigured`), the file routes answer `503` and the UI says "File storage isn't
  set up yet". No public bucket URL is ever built.
- Object keys: `attachments/<uuid>/<file-name>`, `thumbnails/diagrams/<diagram-id>.png`,
  `backups/` and `tmp/` (the backup workflow).
- Upload flow (ISS-9): `startUpload` checks the parent and inserts a `pending` row (at most
  20 per user per 10 minutes) → the browser PUTs to R2 → `confirmUpload` HEADs the object
  and marks it `ready`, or deletes object and row when size or type differ. Images are
  downscaled to 2560 px and re-encoded as WebP in the browser when that is smaller. Pending
  uploads older than 24 h are purged a few at a time on every upload; to clear a backlog run
  `DATABASE_URL='…' R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=…
pnpm purge:pending-uploads`. Files of a deleted issue, doc or comment are not served.

### Setup (once, in the Cloudflare dashboard)

Never paste the values into the repo, an issue or a chat; they go only into Vercel, GitHub
Actions secrets and your git-ignored `.env.local`.

1. **R2 → Create bucket**, e.g. `stockkart-hq-files`. Keep it **private**: do not connect a
   custom domain and leave the `r2.dev` public URL **disabled**.
2. **R2 → Manage API tokens → Create API token**: permission **Object Read & Write**,
   scoped to **that bucket only** ("Apply to specific buckets only"), no expiry or a
   reminder to rotate. Copy the Access Key ID and Secret Access Key (shown once). The
   account id is on the R2 overview page.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in
   Vercel (Production; a separate bucket and token for Preview if previews may upload) and
   in `.env.local` for local development, then redeploy (the CSP picks up the R2 origin at
   build time).
4. **Bucket → Settings → CORS policy**: allow the HQ origins to `PUT` (uploads) and `GET`
   with the signed headers, nothing else:

   ```json
   [
     {
       "AllowedOrigins": ["https://<your-hq-domain>", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type", "Content-Length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   (Add `http://127.0.0.1:3000` too if you open the dev server by IP.)

5. **Bucket → Settings → Object lifecycle rules**: delete objects with prefix `tmp/` after
   **1 day** (left-overs of failed backups). Backup retention is done by the workflow (see
   "Backups").
6. **Cloudflare → Notifications → Add**: a billing / usage notification for R2, so a
   runaway upload loop cannot run up a bill unnoticed (the free tier covers 10 GB).

Check: an anonymous `curl -I https://<account-id>.r2.cloudflarestorage.com/<bucket>/x`
must be denied (`400`/`403`), and `curl -I https://<your-hq-domain>/api/files/x` must answer
`401`.

The app can only sign or touch `attachments/` and `thumbnails/` keys, but its token can
read the whole bucket. To keep the database backups out of reach of a compromised app
token, consider a separate backups bucket with its own token: the backup workflow reads its
own GitHub secrets, so `R2_BUCKET` there can differ from Vercel's.

## Backups

`.github/workflows/backup.yml` runs nightly (and on demand: Actions → "Nightly database
backup" → Run workflow, with optional `weekly` and `prune` inputs): `pg_dump` → gzip →
private R2 bucket. It stays a no-op until these repository secrets exist:
`BACKUP_DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`. The dump is streamed to R2 and never stored as a workflow artifact, because
artifacts of a public repo can be downloaded by anyone.

- **`BACKUP_DATABASE_URL` must be the DIRECT connection string**: Neon → Connect → turn
  **Connection pooling off**, so the host has no `-pooler` (pg_dump needs a real session,
  which PgBouncer's transaction pooling does not give). The job fails early with a clear
  message on a pooled host. Prefer a read-only role.
- **Retention: 7 daily + 4 weekly.** Every night writes `backups/daily/<YYYY-MM-DD>.sql.gz`;
  on Sundays it is also copied (server-side) to `backups/weekly/<YYYY-MM-DD>.sql.gz`. Then
  daily copies 7+ days old and weekly copies 28+ days old are deleted through the S3 API
  (list + delete). The date rule is `scripts/backup-retention.sh`, unit-tested in
  `src/test/backup-retention.test.ts`; it never selects keys outside those two layouts.
- Each dump is uploaded to `tmp/` first and moved into place only when `pg_dump` succeeded
  (a failed dump is deleted, and nothing is pruned); keep the lifecycle rule that deletes
  `tmp/` objects after 1 day. A `backups/` lifecycle rule is no longer needed (if you keep
  one as a safety net, make it longer than 28 days).

Restore: [scripts/restore-backup.md](scripts/restore-backup.md) (download → `gunzip | psql`
into a new Neon branch, never straight over `main`).

## Manual checklist (owner)

- [ ] Create the GitHub repo `Stockkart/stockkart-hq` (public), add it as `origin`, push `main`.
- [ ] GitHub → Settings → Code security: enable **secret scanning** and **push protection** (S-6).
- [ ] Protect `main`: require the CI workflow to pass before merging.
- [ ] Create the Neon project with `main` and `dev` branches, then run `pnpm db:migrate` and
      `pnpm db:seed` on both.
- [ ] Generate a production `AUTH_SECRET` (`openssl rand -base64 32`) and a separate preview one.
- [ ] Create the Vercel project and set `DATABASE_URL`, `STOCKKART_API_URL` and `AUTH_SECRET`
      for Production and Preview (Preview → Neon `dev`).
- [ ] Vercel → Settings → Deployment Protection: enable it for **preview deployments** (S-11).
- [ ] Make sure the inventory-api change adding `SUPER_USER` is deployed and at least one
      `SUPER_USER` account exists.
- [ ] Before adding any real content, run the S-10 anonymous checks against the deployed
      URL. Each must be denied:

      ```bash
      HQ=https://<your-hq-domain>
      curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$HQ/"          # 307 → /login
      curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$HQ/STK/issues/STK-1"  # 307 → /login
      curl -s -w '\n%{http_code}\n' "$HQ/api/files/x"                         # 401 {"error":"unauthorized"}
      curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Next-Action: x' "$HQ/my-work"  # 307, no data
      ```

      Any `200` with content means stop and fix before going further.

- [ ] Sign in as a `SUPER_USER` (you should see "My Work") and as an OWNER/CASHIER (you should
      see "Access denied").
- [ ] Later: add the backup secrets listed under "Backups" and an R2 lifecycle rule.
- [ ] Apply migrations `0002_sprint_activity` and `0003_github_integration` to each Neon
      branch (`pnpm db:migrate` applies them in order), then set up the org
      webhook as in "GitHub integration" and check its `ping` in Recent Deliveries.
- [ ] Apply migration `0004_p1_foundation` (watchers, notifications, saved views,
      attachments, diagrams) to each Neon branch, then set up R2 as in "File storage (R2)".
- [ ] Email digest (optional): verify a Resend sending domain, set `RESEND_API_KEY`,
      `RESEND_FROM_EMAIL`, `APP_BASE_URL` and `CRON_SECRET` in Vercel as in "Email digest",
      then check `/unsubscribe` and `/api/cron/digest` (without the header: 401) after deploy.
- [ ] Costs (COST-1…9): apply migration `0007_costs` to each Neon branch on its own
      (it adds enum values; see AGENTS.md), set `CRON_SECRET` in Vercel (Production) for the
      monthly reminder, then check `/api/cron/monthly` without the header: 401.
- [ ] Board and list views (BRD-6, VW-4): apply migration `0008_view_defaults` to each Neon
      branch. It only adds nullable / defaulted columns (no enum values), so it may be
      applied before the deploy: the code built for 0007 keeps working.

## Security notes

- Secrets live only in Vercel and GitHub Actions. No real data in seeds, fixtures or tests.
- Security headers (CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `nosniff`) are set in
  `next.config.ts`. The CSP allows inline scripts because the App Router needs them without
  nonces; a nonce-based CSP is planned before Phase 1.
- The dev and start scripts bind to `127.0.0.1`. Do not add `--hostname 0.0.0.0`.
- There is no auth bypass for tests. Unit tests inject fakes; e2e tests cover only anonymous
  behaviour.
