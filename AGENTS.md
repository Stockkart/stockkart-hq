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
  on 11.x while CI runs Node 20 (12.x needs Node 22). `@aws-sdk/client-s3` and
  `@aws-sdk/s3-request-presigner` (R2) are Apache-2.0; AWS SDK releases after early 2027
  need Node 22, so they too stay pinned until CI drops Node 20.
  Diagrams: `@excalidraw/excalidraw`, `@xyflow/react` and `@dagrejs/dagre` are MIT
  (Excalidraw pulls in `pako` (MIT AND Zlib), `fractional-indexing` 3 (CC0-1.0) and old
  Radix packages with React 18 peer ranges, which work on React 19). elkjs was not used
  (EPL-2.0/GPL). Both canvases load only via `next/dynamic` on the diagram page.

## Layout

```
src/
  app/(auth)/login/       login page + client form
  app/(app)/              signed-in app shell (layout calls requirePageSession); my-work/, todos/,
                          notifications/, settings/profile/
  app/(app)/[projectKey]/ project pages: issues/, issues/[key]/, backlog/, board/, docs/
                          (tree layout, list, docs/[id] editor), adrs/, sprints/ (list,
                          sprints/[sprintId]), diagrams/ (grid, diagrams/[id] editor), and a
                          "coming soon" [section] placeholder for
                          the rest (roadmap, …)
  app/api/auth/           Auth.js route handlers
  app/api/webhooks/github GitHub org webhook (GH-1…GH-3): HMAC-verified, logic in server/github/
  app/api/files/          authed file downloads (S-5): [id] (attachments) and
                          thumbnail/diagram/[id]; 302 to a presigned R2 URL (≤ 5 min)
  proxy.ts                default-deny gate (Next.js 16 name for middleware.ts)
  env.ts                  Zod-validated server env (throws on import if invalid)
  server/auth/            Auth.js config, inventory-api client, rate limit, session policy
  server/actions/         server actions ("use server"), each starting with requireSession()
  server/services/        DB logic as factories (createIssueService(db) …); index.ts wires db;
                          notifications.ts: notify() and the in-statement notification
                          CTEs (NTF-1); watchers.ts (ISS-11); mentions.ts (MY-1)
  server/storage/         private R2 bucket (S-5): presigned upload/download, key layout,
                          fail-closed StorageNotConfigured; index.ts wires env
  server/db/              Drizzle schema, client, seed, AppDatabase type
  server/import/          handbook import (IMP-1…3), driven by scripts/import-handbook.ts
  server/github/          webhook: signature check, Zod payloads, pure event → plan rules
                          (services/github.ts applies a plan in ONE statement, deduped by
                          delivery id; never add a webhook write outside that statement)
  lib/                    isomorphic code: constants, Zod input schemas, keys, rich text,
                          markdown → editor JSON (lib/markdown), upload policy
                          (lib/attachments/policy.ts), @user mentions (lib/mentions.ts),
                          plain-text rules per editor node (lib/rich-text-nodes/)
  features/               feature UI (shell/, issue/, planning/, sprints/, todos/, search/,
                          docs/, editor/, notifications/, diagrams/, settings/project/ (PRJ-3), views/
                          (VW-3 saved views), bulk/ (ISS-12 selection + bulk bar), trash/
                          (ISS-13))
  features/shell/shortcuts.ts  the one keyboard-shortcut registry (§9.5): handlers match
                          keys with `matchesShortcut`, the `?` dialog lists it; add new
                          shortcuts there
  features/editor/        shared Tiptap editor (client-only; variants `issue`, `comment`,
                          `doc`), its feature registry (extensions/) and the safe JSON
                          renderer with its node registry (renderers/)
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
- Migration `0004_p1_foundation` holds the schema of the P1 slices, so **they add no
  migration** (talk to the owner first if one seems needed):
  - `watchers` (issue_id, user_id; PK both; ISS-11) and `notifications` (recipient
    `user_id`, `type` enum, entity_type/entity_id, `actor_id`, `meta`, `read_at`; NTF-1).
    `notifications.dedupe_key` is unique and nullable: write `<event>:<userId>` and
    `ON CONFLICT DO NOTHING` so retries never duplicate. Only `read_at` changes, so no
    `updated_at`. Prefer writing them in the statement of the change itself:
    `notificationsInsert` (a CTE body; drops the actor, dedupes),
    `userMentionNotifyCtes`/`userMentionNotifyStatement` (the @mention sync plus a bell entry
    for exactly the newly mentioned users) and `watcherStatusNotifications`. Otherwise call
    `notifySafely(notificationService.notify, …)` after your write: it logs and swallows a
    failure, so a notification never fails the user's action. Watchers are added by the
    writes that make someone reporter, assignee or commenter (ISS-11). A mention's event
    is its entity (`mention:<type>:<id>`), so removing someone and adding them back (e.g.
    while a doc autosaves) does not notify them twice; this is deliberate. The bell's
    unread count comes with the app layout's batch and does not poll: it is current after
    a full page load, a mutation that refreshes the page, or opening the bell, but not
    after a client-side navigation (layouts do not re-render then). Do not "fix" that
    with polling, which would keep Neon's compute awake.
  - `saved_views` (VW-3): user, project, name (unique per user and project), `filter` jsonb
    (the URL filter shape), `shared`, fractional `position`.
  - `attachments` (ISS-9): entity_type `issue|comment|doc`, `storage_key` (unique),
    filename, mime, `size_bytes` (CHECK 1 B…10 MB), width/height, uploader, `status`
    `pending|ready`, soft delete. Serve only `ready`, undeleted rows, via `/api/files/[id]`.
  - `diagrams` (DGM-1…7) and `diagram_versions` (DGM-4): like docs (optimistic `version`,
    fractional `position`, `scene_text` → generated `search` + GIN, soft delete), plus
    `kind` `whiteboard|flow`, `thumbnail_key`, `template_id`. CHECK
    `octet_length(scene::text) < 2 MB` (`DIAGRAM_SCENE_MAX_BYTES`) on both tables; validate
    input as `JSON.stringify(scene)` ≤ `DIAGRAM_SCENE_INPUT_MAX_BYTES` (1.5 MB, headroom for
    jsonb's wider text form). Search indexes the first 200 000 characters of `scene_text`.
  - `attachments.storage_key` and `diagrams.thumbnail_key` have CHECKs for the exact key
    layouts (`attachmentKey`, `diagramThumbnailKey`).
  - Diagram templates are `templates` rows with `kind = 'diagram'` and
    `subtype = '<whiteboard|flow>:<slug>'` (one built-in per subtype); `content` is a scene.
    Docs embed diagrams with the `diagramEmbed` node; backlinks are found in the doc JSON
    at read time (`diagramQueries.links`), so doc saves keep no diagram links in sync.
    Whiteboard images stay disabled until diagram files get an R2 key layout.
  - `projects.default_assignee_id` (PRJ-3), `users.notify_email` (NTF-2, default off),
    `entity_type = 'attachment'`. That enum value is added in 0004 inside the migration
    transaction, so no later SQL migration may use `'attachment'` (default, index predicate,
    CHECK, backfill) until 0004 is applied everywhere on its own; a fresh database that
    applies both at once would fail. App queries may use it freely.
- @user mentions: `extractUserMentionIds(doc)` (`lib/mentions.ts`) reads `mention` nodes;
  `userMentionSyncCtes` / `userMentionSyncStatement` (`services/sql.ts`) keep the
  `to_type = 'user'` mention links in sync, like the issue-key ones, and RETURN the newly
  mentioned users so only they are notified.
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
  events use `entity_type = 'sprint'` (`sprint_started.meta` is the start snapshot). They
  also replay `deleted`/`restored` (trash, ISS-13), and the `status_deleted` /
  `status_category_changed` notes the project settings write on every started sprint
  (`SPRINT_ACTIONS`), so a workflow change never rewrites a past sprint.
- Workflow writes (`services/project-settings.ts`) run under the per-project advisory lock
  `hq.workflow:<projectId>` as a `RunAtomic`; keep the rules "one status per category" and
  "one default per kind" there. "Won't Do" is recognised by name (velocity, GH-3), so it
  cannot be renamed.
- Rich text is stored as editor JSON (`RichTextDoc`, validated by `richTextDocSchema`) plus
  plain text. Render it with `RichTextView`; never render stored HTML.
- Docs use optimistic locking (§7.4): a content save is `UPDATE … WHERE version = base`
  (`saveDoc` in `services/docs.ts`); losing returns the winner's copy, never overwrites.
  Tree moves and deletes take a per-project advisory lock in the same transaction, so the
  cycle check sees the tree as it is. Mermaid SVG is inserted only after DOMPurify (S-8).

## File storage (R2)

- Use only `@/server/storage` (server-only; it imports `@/env`). Never build an R2 or
  public URL yourself, and never make the bucket or an object public (S-5).
- Keys come from `attachmentKey(filename)` / `diagramThumbnailKey(id)`; every storage call
  refuses any other key (`isAppKey`), so `backups/` and `tmp/` (the workflow's) are never
  signed or touched by the app, even from a bad DB row.
- Pick the stored type with `classifyUpload(mime, filename).contentType` and pass exactly
  that to `presignUpload`/`putObject` (anything else is refused). Size limit 10 MB
  (`MAX_ATTACHMENT_BYTES`). The client's mime type and name are untrusted.
- Upload flow: insert a `pending` attachment row → `presignUpload` → the browser PUTs to
  R2 → a server action `headObject`s it, checks size and type, and sets `ready`. A signed
  PUT stays usable for its 5 minutes, so the uploader could replace the object with another
  of the same type and size until then; do not treat the bytes as immutable before that.
- Catch `StorageNotConfigured` and show `STORAGE_NOT_CONFIGURED_MESSAGE`. Tests inject a
  transport (`createStorage(config, () => fakeTransport)`); presigning is local and needs
  no network.
- Attachments (ISS-9) are implemented in `services/attachments.ts` (start / confirm /
  cancel / soft delete by the uploader / comment adoption / pending purge) and
  `actions/attachments.ts`. Downloads and the panel only see `ready` files of a live
  parent (`liveAttachmentParent`). UI: `features/attachments/` (panel, upload client,
  image downscaling); editor nodes `image` / `fileAttachment` via the registries. Wrap an
  editor in `AttachmentUploadProvider` (target entity + `storageReady`) to enable paste and
  drop; a new comment's files go to its issue (`draft`: no page refresh) and move onto the
  comment once it is posted. Saving is blocked while an upload placeholder is in the doc
  (`hasPendingUploads`); doc autosave strips placeholders (`withoutPendingUploads`).

## Adding an editor node

The editor, the plain-text extractor and the read-only renderer each have a registry, so
a feature adds files of its own plus ONE line per registry (no edits to the shared files):

1. `src/features/editor/extensions/<feature>.ts`: export an `EditorFeature` (`name`,
   `variants` among `issue`/`comment`/`doc`, `extensions(context)`, optional
   `insertButtons` / `toolbarGroups`), and add it to `EDITOR_FEATURES` in
   `extensions/index.ts`. Client-only code (node views, suggestion popups) lives next to it.
2. `src/lib/rich-text-nodes/<feature>.ts`: export `PlainTextRules` for the node types
   (`block`, `code`, `text(node)` for text held in attrs) and add them to `RULES` in
   `rich-text-nodes/index.ts`, so search and `STK-123` extraction see the node.
3. `src/features/editor/renderers/<feature>.tsx`: export `NodeRenderers` (React elements
   only, validate every attr, no "use client") and add them to `RENDERERS` in
   `renderers/index.ts`. Unregistered types render only their children.
4. Test the three pieces next to their files. The existing doc blocks (`doc-blocks.ts[x]`
   in each folder: callout, table, Mermaid) are the reference. Registering a node type or
   feature name twice throws at load (`mergeRegistries`), so a merge collision fails tests.

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
