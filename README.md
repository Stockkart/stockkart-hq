# Stockkart HQ

A small, private work tracker and knowledge base for the Stockkart team: issues, docs,
ADRs and diagrams in one place, linked together. See [SPEC.md](SPEC.md) for the full product
and technical spec.

**The code is public; the data is private.** Every page and API route requires a session,
and only Stockkart accounts with the `SUPER_USER` role can sign in.

Status: **Phase 0** (scaffold). Sign-in, sessions, default-deny routing, rate limiting and
an empty app shell. Issues, boards and docs arrive in Phase 1.

## Stack

| Layer     | Choice                                                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict)                                  |
| Auth      | Auth.js (`next-auth` 5 beta) Credentials provider → Stockkart backend (`inventory-api`) |
| DB        | Neon Postgres, Drizzle ORM, `@neondatabase/serverless` (HTTP driver)                    |
| UI        | Tailwind CSS 4, shadcn/ui components, lucide-react                                      |
| Tests     | Vitest + Testing Library (unit), Playwright (smoke)                                     |
| Tooling   | pnpm (via corepack), ESLint, Prettier, Husky + lint-staged                              |
| Hosting   | Vercel (Hobby), GitHub Actions CI                                                       |

All dependency versions are pinned exactly.

## How sign-in works

1. The login form posts to a server action. The server checks the rate limit (5 failed
   attempts per email and 20 per IP per 15 minutes, stored in `login_attempts`).
2. The HQ server calls `POST {STOCKKART_API_URL}/api/v1/auth/login`. This is
   server-to-server, so the browser never sees the Stockkart token.
3. Only `user.role === "SUPER_USER"` gets in. Any other role sees "Access denied", and HQ
   calls `/auth/logout` to drop the token it was just issued.
4. HQ upserts the `users` row (keyed by the Stockkart `userId`) and issues an Auth.js
   session: an encrypted JWT in an httpOnly cookie that holds the Stockkart token. The
   session ends no later than the 7-day Stockkart token.
5. About once an hour the proxy re-checks `GET /api/v1/auth/me`. A 401/403 or a role change
   ends the session. A 5xx or timeout keeps it, so HQ still works while inventory-api is down.
6. Sign-out ends the HQ session and calls `/auth/logout`.

`src/proxy.ts` (Next.js 16's name for `middleware.ts`) denies every route without a session
except `/login`, `/api/auth/*`, `/api/webhooks/github` (placeholder, returns 501) and static
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
| `GITHUB_WEBHOOK_SECRET`                                                  | later    | GitHub webhook HMAC (Phase 2)                                                                                        |

Generate `AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

### Scripts

| Command                                            | What it does                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                         | Dev server on 127.0.0.1:3000                                                                                               |
| `pnpm build` / `pnpm start`                        | Production build / serve on 127.0.0.1                                                                                      |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Static checks                                                                                                              |
| `pnpm test`                                        | Unit tests (Vitest). Never touch the network: fetch and the DB are faked                                                   |
| `pnpm test:e2e`                                    | Playwright smoke tests against a production build (run `pnpm build` first; first time: `pnpm playwright install chromium`) |
| `pnpm db:generate`                                 | Generate a SQL migration from `src/server/db/schema.ts` into `drizzle/`                                                    |
| `pnpm db:migrate`                                  | Apply migrations to `DATABASE_URL`                                                                                         |

## Database (Neon)

1. Create a Neon project (Postgres 17) in the region nearest your Vercel functions.
2. Create two branches: `main` (production) and `dev` (local development and previews,
   no real data).
3. Copy each branch's **pooled** connection string. Use the `dev` one in `.env.local`.
4. Apply migrations. The URL is read from your shell, so it never lands in a file:

   ```bash
   DATABASE_URL='postgres://…' pnpm db:migrate
   ```

Schema changes: edit `src/server/db/schema.ts`, run `pnpm db:generate --name <change>`,
review and commit the SQL in `drizzle/`, then migrate `dev` before `main`.

## Deploying to Vercel

1. Import the GitHub repo in Vercel (framework preset: Next.js; Vercel runs `pnpm install`
   and `pnpm build` using `packageManager` from package.json).
2. Set the environment variables (`DATABASE_URL`, `STOCKKART_API_URL`, `AUTH_SECRET`) for
   **Production** with the Neon `main` branch. For **Preview**, use the Neon `dev` branch
   and a different `AUTH_SECRET`.
3. Apply migrations to the target Neon branch before deploying a change that needs them.
4. Deploy, then run the anonymous-denial checks below before adding any real content.

## Backups

`.github/workflows/backup.yml` runs nightly: `pg_dump` → gzip → private R2 bucket under
`backups/`. It stays a no-op until these repository secrets exist: `BACKUP_DATABASE_URL`
(prefer a read-only Neon role), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The dump is streamed to R2 and never stored as a
workflow artifact, because artifacts of a public repo can be downloaded by anyone. Add an
R2 lifecycle rule that deletes `backups/` objects after 30 days.

Restore (into an empty Neon branch first, never straight over `main`):

```bash
# download with any S3 client using the R2 endpoint, then:
gunzip -c stockkart-hq-<timestamp>.sql.gz | psql "$RESTORE_DATABASE_URL"
```

## Manual checklist (owner)

- [ ] Create the GitHub repo `Stockkart/stockkart-hq` (public), add it as `origin`, push `main`.
- [ ] GitHub → Settings → Code security: enable **secret scanning** and **push protection** (S-6).
- [ ] Protect `main`: require the CI workflow to pass before merging.
- [ ] Create the Neon project with `main` and `dev` branches, then run `pnpm db:migrate` on both.
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

## Security notes

- Secrets live only in Vercel and GitHub Actions. No real data in seeds, fixtures or tests.
- Security headers (CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `nosniff`) are set in
  `next.config.ts`. The CSP allows inline scripts because the App Router needs them without
  nonces; nonce-based CSP is a possible later hardening.
- The dev and start scripts bind to `127.0.0.1`. Do not add `--hostname 0.0.0.0`.
- There is no auth bypass for tests. Unit tests inject fakes; e2e tests cover only anonymous
  behaviour.
