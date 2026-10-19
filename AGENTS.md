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

## Layout

```
src/
  app/(auth)/login/       login page + client form
  app/(app)/              signed-in app shell (layout calls requirePageSession)
  app/api/auth/           Auth.js route handlers
  app/api/webhooks/github placeholder (501) until GH-1
  proxy.ts                default-deny gate (Next.js 16 name for middleware.ts)
  env.ts                  Zod-validated server env (throws on import if invalid)
  server/auth/            Auth.js config, inventory-api client, rate limit, session policy
  server/actions/         server actions ("use server"), each starting with requireSession()
  server/db/              Drizzle schema + client
  features/               feature UI (shell/, later backlog/, board/, …)
  components/ui/          shadcn/ui components (owned code, edit freely)
  test/                   test fakes
drizzle/                  generated SQL migrations (committed)
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

## Tests

- Unit tests sit next to the code (`*.test.ts[x]`) and never hit the network or a real DB:
  mock `fetch` (see `src/test/stockkart-fakes.ts`) and inject in-memory stores.
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
