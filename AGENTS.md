# AGENTS.md

Conventions for coding agents (and humans) working in this repo. Read [SPEC.md](SPEC.md)
before changing behaviour. Requirement IDs (AUTH-4, S-2, …) are stable; cite them in
comments and commit bodies.

## Ground rules

- **The repo is public. The data is private.** Never commit secrets, real user data, imported
  handbook content, database dumps or screenshots of real content. `.env*` stays ignored
  except `.env.example`, which holds names only.
- **Default deny.** Every route requires a session unless it is listed in
  `src/server/auth/access-policy.ts`. Do not add public paths without a SPEC requirement.
- **Re-check in server code.** Every server action and route handler starts with
  `await requireSession()` (or uses `withSession(...)` for route handlers). Server components
  use `requirePageSession()`. The proxy alone is not trusted (S-2, AUTH-6).
- **No test bypasses.** Never add auth shortcuts keyed on `NODE_ENV`. If one is ever needed it
  must be opt-in through a purpose-named env var and default to deny.
- **Never log tokens or passwords.** The Stockkart access token lives only in the encrypted
  Auth.js JWT. `session.user` exposes `id`, `name` and `email` only.
- **Fail closed.** Missing configuration or an unreachable dependency must stop sign-in, not
  skip a check. Env is validated in `src/env.ts`; add new variables there and in
  `.env.example`.
- **Bind to localhost.** Dev and start scripts use `--hostname 127.0.0.1`. Never use `0.0.0.0`.
- **Pinned dependencies.** Exact versions only (no `^` or `~`; `.npmrc` sets `save-exact`).
  Check the license of every new package (MIT, Apache-2.0, BSD or ISC; no GPL or paid add-ons).
  The editor is Tiptap rather than BlockNote because BlockNote is MPL-2.0;
  `fractional-indexing` is CC0-1.0 (public domain dedication), accepted explicitly.
  DOMPurify is dual-licensed MPL-2.0 OR Apache-2.0; we use it under Apache-2.0. Recharts is
  MIT (its d3 parts via `victory-vendor` are ISC). mermaid stays
  on 11.x while CI runs Node 20 (12.x needs Node 22).

## Layout

```
src/
  app/(auth)/login/       login page + client form
  app/(app)/              signed-in app shell (layout calls requirePageSession); my-work/, todos/,
                          settings/profile/
  app/(app)/[projectKey]/ project pages: issues/, issues/[key]/, backlog/, board/, docs/
                          (tree layout, list, docs/[id] editor), adrs/, sprints/ (list,
                          sprints/[sprintId]), and a "coming soon" [section] placeholder for
                          the rest (roadmap, …)
  app/api/auth/           Auth.js route handlers
  app/api/webhooks/github GitHub org webhook (GH-1…GH-3): HMAC-verified, logic in server/github/
  proxy.ts                default-deny gate (Next.js 16 name for middleware.ts)
  env.ts                  Zod-validated server env (throws on import if invalid)
  server/auth/            Auth.js config, inventory-api client, rate limit, session policy
  server/actions/         server actions ("use server"), each starting with requireSession()
  server/services/        DB logic as factories (createIssueService(db) …); index.ts wires db
  server/db/              Drizzle schema, client, seed, AppDatabase type
  server/import/          handbook import (IMP-1…3), driven by scripts/import-handbook.ts
  server/github/          webhook: signature check, Zod payloads, pure event → plan rules
                          (services/github.ts applies a plan in ONE statement, deduped by
                          delivery id; never add a webhook write outside that statement)
  lib/                    isomorphic code: constants, Zod input schemas, keys, rich text,
                          markdown → editor JSON (lib/markdown)
  features/               feature UI (shell/, issue/, planning/, sprints/, todos/, search/,
                          docs/, editor/)
  features/editor/        shared Tiptap editor (client-only; `variant="doc"` adds tables,
                          callouts and Mermaid blocks) and the safe JSON renderer
  components/ui/          shadcn/ui components (owned code, edit freely)
  test/                   test fakes and the DB-test helpers
drizzle/                  generated SQL migrations (committed)
scripts/                  seed.ts, import-handbook.ts, send-test-webhook.ts (signed local delivery)
e2e/                      Playwright smoke tests
```

## Code style

- TypeScript strict with `noUncheckedIndexedAccess`. No `any`, `as any`, `@ts-ignore` or
  `@ts-expect-error`; ESLint enforces this. Prefer Zod parsing over type assertions at
  boundaries (env, HTTP responses, form data).
- Use `import { type X }` for type-only imports. The `@/` alias maps to `src/`.
- Server-only modules (anything importing `@/env` or `@/server/db`) must never be imported
  from a `"use client"` file. Client components call server actions instead.
- Write dependency-injected factories (`createX(deps)`) for logic that talks to the network
  or the DB, and wire the real dependencies in one place (`server/auth/auth.ts`).
- Add an inline comment wherever auth or security logic is not obvious.
- Accessibility: every input has a `<label>`, errors use an `aria-live` region, and
  everything is keyboard-usable (SPEC §9.5).
- Prettier formats the code (100 columns, double quotes, trailing commas). Husky runs
  lint-staged on commit.

## Database

- Edit `src/server/db/schema.ts`, then `pnpm db:generate --name <change>` and commit the SQL
  in `drizzle/`. Never edit an applied migration; add a new one.
- Every table has `id uuid`, `created_at` and `updated_at` unless SPEC §8 says otherwise.
- The schema already holds every Phase 1 table (issues, docs, sprints, todos, templates,
  `recent_views` for MY-1 …), plus `entity_type = 'user'` for @mentions and
  `docs.source_path` for re-runnable imports. Phase 1 slices must not need a migration;
  later phases add their own tables.
- Shared vocabularies (issue types, statuses, doc types …) live in `src/lib/**/constants.ts`
  and feed both the `pgEnum`s and the Zod schemas. Adding an enum value needs a migration.
- Soft delete: tables with `deleted_at` are never hard-deleted by the app; every read
  filters `deleted_at IS NULL`.
- Ordering columns (`issues.rank`, `docs.position`, `todos.position`) hold
  `fractional-indexing` keys, use `COLLATE "C"` and move one row at a time (a key between
  the new neighbours). `issues.rank` is unique per project: on a unique violation, re-read
  the neighbours and retry, as `createIssue` does.
- `search` columns are `GENERATED` tsvectors with GIN indexes; write the `*_text` column
  (derived on the server from the rich-text JSON with `extractPlainText`), never `search`.
- Neon's HTTP driver has no interactive transactions. A write that must be atomic is ONE
  SQL statement (data-modifying CTEs, see `services/issues.ts`). When a later step must see
  the database after an earlier step's row lock (all CTEs share one snapshot taken before
  the lock wait), use `RunAtomic` (`db.batch()` on Neon, a transaction on node-postgres) with
  separate statements, as the mention sync does. Parse raw results with `rowsOf(result, zodRow)`.
- `activity` is append-only: record `from_value` → `to_value` as raw text (ids, numbers,
  ISO dates) in the same statement as the change; the UI resolves names. The sprint
  burndown and velocity (SPR-3/4, `lib/sprints/burndown.ts`) replay the `sprint`, `status`
  and `storyPoints` rows, so every write of those fields must log them; sprint lifecycle
  events use `entity_type = 'sprint'` (`sprint_started.meta` is the start snapshot).
- Rich text is stored as editor JSON (`RichTextDoc`, validated by `richTextDocSchema`) plus
  plain text. Render it with `RichTextView`; never render stored HTML.
- Docs use optimistic locking (§7.4): a content save is `UPDATE … WHERE version = base`
  (`saveDoc` in `services/docs.ts`); losing returns the winner's copy, never overwrites.
  Tree moves and deletes take a per-project advisory lock in the same transaction, so the
  cycle check sees the tree as it is. Mermaid SVG is inserted only after DOMPurify (S-8).

## Adding a server action

1. Put the Zod input schema in `src/lib/<feature>/schemas.ts` (isomorphic, reused by forms).
2. Put the logic in a service factory in `src/server/services/` that takes `AppDatabase`
   and the actor id, throws `ServiceError` (`notFound`, `invalid`, `forbidden`, `conflict`)
   for expected failures, and is wired once in `services/index.ts`.
3. Export the action from a `"use server"` file in `src/server/actions/`. Its first
   statement is `await requireSession()` (the guard test fails otherwise); then validate
   with the schema and return `ActionResult<T>` (`{ ok: true, data }` or
   `{ ok: false, error }`). Use `runAction()` from `actions/action-runner.ts` (parse, call,
   refresh, map `ServiceError`s); see `actions/issues.ts` or `actions/docs.ts`.
4. Test the service against Postgres (`describeDb`) and the action with mocks (session
   required, bad input rejected before the service runs).

## Tests

- Unit tests sit next to the code (`*.test.ts[x]`) and never hit the network or a real DB:
  mock `fetch` (see `src/test/stockkart-fakes.ts`) and inject in-memory stores.
- DB-backed tests (`*.db.test.ts`, wrapped in `describeDb`) run only with `HQ_DB_TESTS=1`
  and a loopback `HQ_TEST_DATABASE_URL` (README "Database tests"); CI's `db-tests` job runs
  them. Use `createTestDatabase()` for an isolated, migrated copy per file.
- Auth changes need tests for both the allow and the deny path.
- Never delete or weaken a failing test to make CI pass; fix the code.

## Before you hand off

Run all of these and make sure they pass:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

`pnpm build` needs the three required env vars. Dummy values are fine; see
`.github/workflows/ci.yml`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`,
in lowercase imperative mood, with a subject under 72 characters. Examples:
`feat(auth): …`, `fix(db): …`, `chore: …`, `ci: …`, `docs: …`, `test: …`.
