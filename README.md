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
Phase 1; roadmap, diagrams, incidents and services are still "coming soon".

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

| Name                                                                     | Required | Purpose                                                                                                              |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | yes      | Neon Postgres connection string (`postgres://…?sslmode=require`)                                                     |
| `STOCKKART_API_URL`                                                      | yes      | inventory-api base URL **without** `/api/v1`. Must be https (http only for localhost)                                |
| `AUTH_SECRET`                                                            | yes      | Auth.js encryption secret, ≥ 32 random bytes                                                                         |
| `AUTH_URL`                                                               | no       | Public URL of the app. Not needed on Vercel. Set it for `next start` elsewhere, and leave it unset rather than empty |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | later    | Attachments (Phase 2). Backups use GitHub secrets instead                                                            |
| `GITHUB_WEBHOOK_SECRET`                                                  | no       | GitHub webhook HMAC secret (`openssl rand -hex 32`). Unset: the app runs, the webhook answers 503 and does nothing   |
| `HQ_LOG_QUERIES`                                                         | no       | `1` logs every database round trip per request (counts and ms only, never SQL). Off by default; see "Performance"    |

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

## GitHub integration

Branches, pull requests and commits that mention an issue key show in the issue's
**Development** panel, and a merged PR that says "Fixes STK-123" moves the issue to Done
(SPEC §4.15, GH-1…GH-4). It is one **organisation webhook**; there is no GitHub App and HQ
holds no GitHub token.

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

## Backups

`.github/workflows/backup.yml` runs nightly: `pg_dump` → gzip → private R2 bucket under
`backups/`. It stays a no-op until these repository secrets exist: `BACKUP_DATABASE_URL`
(prefer a read-only Neon role), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The dump is streamed to R2 and never stored as a
workflow artifact, because artifacts of a public repo can be downloaded by anyone. Add an
R2 lifecycle rule that deletes `backups/` objects after 30 days. Each dump is uploaded to
`tmp/` first and moved to `backups/` only when `pg_dump` succeeded (a failed dump is
deleted); add a second lifecycle rule that deletes `tmp/` objects after 1 day.

Restore (into an empty Neon branch first, never straight over `main`):

```bash
# download with any S3 client using the R2 endpoint, then:
gunzip -c stockkart-hq-<timestamp>.sql.gz | psql "$RESTORE_DATABASE_URL"
```

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

## Security notes

- Secrets live only in Vercel and GitHub Actions. No real data in seeds, fixtures or tests.
- Security headers (CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `nosniff`) are set in
  `next.config.ts`. The CSP allows inline scripts because the App Router needs them without
  nonces; a nonce-based CSP is planned before Phase 1.
- The dev and start scripts bind to `127.0.0.1`. Do not add `--hostname 0.0.0.0`.
- There is no auth bypass for tests. Unit tests inject fakes; e2e tests cover only anonymous
  behaviour.
