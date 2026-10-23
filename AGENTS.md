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
                          (index = tree + list, docs/[id] doc page: read mode, `?edit=1`
                          edit mode; docs/[id]/export DOC-12 .md download), adrs/, sprints/ (list,
                          sprints/[sprintId]), diagrams/ (grid, diagrams/[id] editor), roadmap/
                          (RDM-1/2), releases/ (list, releases/[releaseId]; REL-1/2),
                          incidents/ (list, incidents/[key] = INC-n; INC-1/2), services/ (list,
                          services/[slug]; SVC-1), settings/ (PRJ-3, IMP-4 Import tab), trash/;
                          [section] only 404s unknown sections (inside the app shell)
  app/api/auth/           Auth.js route handlers
  app/api/webhooks/github GitHub org webhook (GH-1…GH-3): HMAC-verified, logic in server/github/
  app/api/files/          authed file downloads (S-5): [id] (attachments) and
                          thumbnail/diagram/[id]; 302 to a presigned R2 URL (≤ 5 min)
  app/api/cron/digest     NTF-2 digest job (Vercel Cron, Bearer CRON_SECRET; public path)
  app/unsubscribe         NTF-2 one-click unsubscribe (token in the link; public path)
  proxy.ts                default-deny gate (Next.js 16 name for middleware.ts)
  env.ts                  Zod-validated server env (throws on import if invalid)
  server/auth/            Auth.js config, inventory-api client, rate limit, session policy
  server/actions/         server actions ("use server"), each starting with requireSession()
  server/services/        DB logic as factories (createIssueService(db) …); index.ts wires db;
                          notifications.ts: notify() and the in-statement notification
                          CTEs (NTF-1); watchers.ts (ISS-11); mentions.ts (MY-1)
  server/storage/         private R2 bucket (S-5): presigned upload/download, key layout,
                          fail-closed StorageNotConfigured; index.ts wires env
  server/email/           NTF-2: Resend sender (fetch), digest job, unsubscribe, route
                          factories; index.ts wires env (fail closed without Resend)
  server/db/              Drizzle schema, client, seed, AppDatabase type
  server/import/          handbook import (IMP-1…3), driven by scripts/import-handbook.ts
  server/github/          webhook: signature check, Zod payloads, pure event → plan rules
                          (services/github.ts applies a plan in ONE statement, deduped by
                          delivery id; never add a webhook write outside that statement)
  server/handbook/        DOC-14 GitHub App client (fetch only), git blob sha, the pure
                          webhook plan for the handbook repo; index.ts wires env
  lib/                    isomorphic code: constants, Zod input schemas, keys, rich text,
                          markdown ↔ editor JSON (lib/markdown: to-rich-text import,
                          from-rich-text export), handbook paths and .md export
                          (lib/docs/handbook-path.ts, markdown-export.ts), line diff
                          (lib/text/line-diff.ts), handbook sync vocabulary (lib/handbook/),
                          upload policy
                          (lib/attachments/policy.ts), @user mentions (lib/mentions.ts),
                          plain-text rules per editor node (lib/rich-text-nodes/)
  features/               feature UI (shell/, issue/, planning/, sprints/, todos/, search/,
                          docs/, editor/, notifications/, diagrams/, settings/project/ (PRJ-3), views/
                          (VW-3 saved views), bulk/ (ISS-12 selection + bulk bar), trash/
                          (ISS-13), roadmap/ (RDM-1/2), releases/ (REL-1/2), import/ (IMP-4
                          CSV import tab), incidents/ (INC-1/2), service-registry/ (SVC-1),
                          docs/comments/ (DOC-11/13 comment panel))
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
- Migration `0005_p2_foundation` holds the schema of the P2 slices, so **they add no
  migration either** (see "P2 slice notes" below for who owns what):
  - `services` (SVC-1): project, name, `slug` (unique per project, even while
    soft-deleted; CHECK format), description, `repo` (`Owner/repo` CHECK), `runtime`,
    `owner_id`, `environments` / `links` jsonb arrays (CHECK: arrays of ≤ 50; types in
    `lib/service-registry/constants.ts`), `notes`, fractional `position`, soft delete.
    **No secrets column, and no credentials anywhere in a row** (notes and URLs included).
  - `incidents` (INC-1): per-project `number` from `projects.incident_counter`, `title`
    (1…200 chars), `severity` `sev1|sev2|sev3`, `status`
    `investigating|mitigated|resolved`, `started_at`, `mitigated_at` (required while
    `mitigated`), `resolved_at` (CHECK: set exactly while `resolved`; times ordered
    started ≤ mitigated ≤ resolved), `commander_id`, `summary` (plain text),
    `postmortem_doc_id`, soft delete, generated `search` (title A, summary B) + GIN.
    `incident_services` (PK both, cascade; same-project is the app's check) and
    `incident_timeline` (`at`, `author_id`, `kind` `note|status_change|action`, `body`
    1…10 000 chars; append-only; index `(incident_id, at)`). Follow-up issues are
    `entity_links` (`incident` → `issue`).
  - `comments` (DOC-13): `anchor_id` (mark id, `^[A-Za-z0-9_-]{1,64}$`), `anchor_text`
    (≤ 500 chars, needs `anchor_id`), `resolved_at` / `resolved_by`, `parent_id` (threads,
    cascade). CHECK: anchors only on `entity_type = 'doc'`; replies carry no anchor or
    resolution (`comments_reply_plain`). A composite FK `(parent_id, entity_type,
entity_id)` → `comments (id, entity_type, entity_id)` keeps a reply on its thread's
    entity. Page-level doc comments (DOC-11) keep `anchor_id` null. Partial index
    `(entity_type, entity_id, anchor_id) WHERE anchor_id IS NOT NULL`.
  - `users.digest_frequency` (`daily|weekly`, default daily), `users.last_digest_at`,
    `users.email_unsubscribe_token_hash` (sha-256 hex, unique, CHECK format) and
    `email_deliveries` (user, `kind` `digest`, period, `sent_at`, `provider_id`, `status`
    `pending|sent|failed|skipped` (default `pending`), `error_code`; unique
    `(user_id, kind, period_start)`) for NTF-2.
  - `imports` (IMP-4): project, `kind` `issues_csv`, filename, `created_by`, `status`
    `previewed|applied|failed`, counts (CHECK consistent), `report` jsonb (< 1 MB),
    `created_at`, `applied_at` (set exactly while `applied`). The raw CSV is never stored.
  - `statuses.wip_limit` (BRD-5, null or 1…999), `sprints.retro_doc_id` and
    `projects.auto_retro` (SPR-5), `releases.description` / `releases.released_at`
    (REL-1; set exactly while `released`, backfilled by 0005), `projects.incident_counter`,
    and a partial index `issues (release_id)` for a release's issues (REL-1/2).
  - `entity_type` gains `service` and `release` (`incident` existed since 0001), and
    `notification_type` gains `comment_on_doc` (DOC-13) and `incident_commander` (INC-1).
    They are added with `ALTER TYPE … ADD VALUE` inside the migration transaction, so — as
    with `'attachment'` — no later SQL migration may use them until 0005 is applied
    everywhere on its own. App queries may use them freely.
  - Two hand edits in the generated 0005 SQL (keep them if it is ever regenerated): the
    `comments_id_entity_unique` constraint is moved above the FK that references it, and
    `released_at` is backfilled before its CHECK is added.
  - ISS-14 clone/convert needs nothing new: link a clone to its source with a `relates`
    issue link and log the source in the `created` activity's `meta`; a type change is an
    `activity` row with `field = 'type'`.
  - Issue roadmap dates need nothing new: an epic's bar is `issues.start_date` →
    `issues.due_date` (both `date`), and RDM-2 dependencies are `issue_links` `blocks` rows.
  - The postmortem, release-notes and sprint-retro doc templates are already seeded
    built-ins (`kind = 'doc'`, subtypes `postmortem`, `release_notes`, `retro`).
- Migration `0006_handbook_foundation` holds the schema of the two handbook slices, so
  **they add no migration** (see "Handbook slice notes"):
  - `docs.handbook_path` (repo path override; `source_path` stays the import origin;
    resolve with `handbookPathFor`), `handbook_blob_sha` + `handbook_synced_version` +
    `handbook_synced_at` (set together, CHECK; synced version ≤ `version`),
    `handbook_remote_sha` (needs `handbook_remote_seen_at`; as built by the sync slice, a
    seen-at without a sha means "changed, blob unknown" and `GIT_NULL_SHA` means "absent on
    the default branch"). Shas are 40 lower-case hex (CHECK); paths follow
    `isHandbookPath` (CHECK, same regex). Unique index on
    `(project_id, lower(coalesce(handbook_path, source_path)))` for live docs: one doc per
    file, so persist the default path into `handbook_path` when a doc is first published.
  - `handbook_publications`: `branch` (`hq/<one segment>`, CHECK; unique per project),
    `pr_number` + `pr_url` (together; `https://github.com/<owner>/<repo>/pull/<n>`),
    `state` `open|merged|closed|failed`, generated `is_open`, `created_by`, `merged_at`
    (exactly while `merged`), `error_code` (only on `failed`, `^[a-z0-9_.-]{1,64}$`).
    `merged`/`closed` need a PR.
  - `handbook_publication_docs` (PK publication + doc; path, `doc_version`, `blob_sha`,
    `open`; one row per path per publication, case-insensitive). **One open publication per doc** = partial unique index on `doc_id WHERE open`.
    `open` is not app-maintained: a composite FK `(publication_id, open)` →
    `handbook_publications (id, is_open)` `ON UPDATE CASCADE` copies the generated flag, so
    an UPDATE of `state` flips it in the same statement (no trigger; a wrong `open` on insert
    fails the FK). Insert rows with the default `open = true` into an open publication.
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

## P2 slice notes

**P2 status: all four slices (A roadmap, B releases, C incidents, D doc comments + digest)
are merged** on top of migration 0005, still without a migration of their own. Where they
meet, both behaviours are kept: `createIssue` takes a fix version (B) and a clone source
(A) in its one statement; `updateIssueField` has both `schedule` (A) and `release` (B);
the issue page batches the clone/convert menu, the fix version, "From incident INC-n" and
the P1 panels in ONE round trip; the bell and the digest format `incident_commander` (C)
and `comment_on_doc` (D); generated postmortems (C) and release notes (B) are ordinary docs,
so the comment panel (D) works on them. `services/p2-cross-slice.db.test.ts` and
`features/incidents/follow-ups.test.tsx` pin these seams; keep them green when changing a
slice. The table below is the original split, kept as the map of who owns what.

Four slices build on migration 0005 in parallel worktrees. **None of them adds a
migration**; if one seems needed, stop and talk to the owner. Each slice owns the new files
under its paths; shared files get small, append-only edits (one line per registry, one
wiring line in `services/index.ts`, one nav entry), so merges stay trivial.

| Slice                                                                              | Owns                                                                                                                                                                                                                                                                         | Touches (append-only)                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Roadmap (RDM-1/2), WIP limits (BRD-5), clone/convert (ISS-14), retro doc (SPR-5) | `app/(app)/[projectKey]/roadmap/`, `features/roadmap/`, `lib/roadmap/`, `services/roadmap-queries.ts`                                                                                                                                                                        | board column header (`features/planning/`), `services/project-settings.ts` (WIP limit, `auto_retro`), `services/issues.ts` + `actions/issues.ts` (clone/convert), `services/sprints.ts` (retro on completion) |
| B Releases (REL-1/2), CSV import (IMP-4)                                           | `app/(app)/[projectKey]/releases/`, `features/releases/`, `lib/releases/`, `services/releases.ts`, `services/release-queries.ts`, `actions/releases.ts`, `features/import/`, `services/imports.ts`, `actions/imports.ts`                                                     | `lib/imports/constants.ts`, the issue "Fix version" field (`features/issue/`)                                                                                                                                 |
| C Incidents (INC-1/2), services (SVC-1)                                            | `app/(app)/[projectKey]/incidents/`, `app/(app)/[projectKey]/services/`, `features/incidents/`, `features/service-registry/`, `services/incidents.ts`, `services/incident-queries.ts`, `services/service-registry.ts`, `actions/incidents.ts`, `actions/service-registry.ts` | `lib/incidents/`, `lib/service-registry/`, `services/incident-numbers.ts`, search kinds (`lib/search/`)                                                                                                       |
| D Inline doc comments (DOC-13), email digest (NTF-2)                               | `features/editor/extensions/comment-mark.ts` (+ its rich-text-nodes and renderer entries), `features/docs/comments/`, `server/email/`, the digest job and unsubscribe route                                                                                                  | `services/comments.ts`, `features/settings/profile/` (frequency), `env.ts` + `.env.example` (Resend), `lib/notifications/constants.ts`                                                                        |

Slice A also owns the new `services/sprint-retros.ts`, `lib/sprints/retro.ts`,
`lib/issues/convert.ts`, `lib/planning/wip.ts` and `lib/settings/wip-limit.ts`.

Gotchas:

- **Enum gotcha.** `entity_type` values `service` and `release`, and `notification_type`
  values `comment_on_doc` and `incident_commander`, arrive in 0005 via
  `ALTER TYPE … ADD VALUE`; Postgres refuses to use a value in the transaction that added it,
  and drizzle-kit applies all pending migrations in one transaction. App code may use them;
  a future migration must not (default, CHECK, index predicate, backfill) until 0005 is
  applied everywhere.
- **Incident numbers** come only from `allocateIncidentNumber`
  (`services/incident-numbers.ts`): one statement that bumps `projects.incident_counter`,
  inserts the incident and logs `created`. Never `max(number) + 1`. Validate input with Zod
  first (severity, a real commander): a bad value surfaces as a raw Postgres error. Notify
  a new commander with `incident_commander`.
- **Status ⇔ timestamp CHECKs.** `incidents.resolved_at` is set exactly while
  `status = 'resolved'` (reopening clears it) and `mitigated` needs `mitigated_at`; likewise
  `imports.applied_at` ⇔ `applied`, `email_deliveries.sent_at` ⇔ `sent` (`error_code`
  only on `failed`), and `releases.released_at` ⇔ `released`. Write both columns in the
  same UPDATE.
- **No secrets in the registry.** Validate every service link and environment URL with
  `parseSafeUrl` / `safeUrlSchema` (`lib/links/safe-url.ts`: absolute http(s), no
  `user:password@`, no `javascript:`/`data:`, no invisible characters). Never add a
  secrets column or field. These URLs may point at `localhost` or private hosts: only show
  them as links, never fetch them from the server (SSRF).
- **Inline comments.** Anchors live in the doc JSON as a mark with a stable id; the row
  keeps `anchor_id` and the quoted `anchor_text`, never character offsets. Replies set
  `parent_id` to the thread's top comment and carry no anchor or resolution (CHECK); the
  composite FK keeps them on the same doc. Resolve on the top comment. Notify with
  `comment_on_doc`.
  Implemented (slice D): the mark is `features/editor/comment-anchor-mark.ts`; the editor
  asks the page with a cancelable `hq:comment-anchor-request` DOM event
  (`comment-anchor-events.ts`) and adds the mark only if the doc page's panel
  (`features/docs/comments/`) accepts it. The panel highlights open anchors with a
  generated `<style>` (resolved ones stay plain) and orders threads with
  `anchorIdsInOrder` of the live content. Marks render through `MARK_RENDERERS`
  (`renderers/index.ts`), a mark registry next to the node one.
- **Digest idempotency and unsubscribe.** Claim a period by inserting a `pending`
  `email_deliveries` row first (`ON CONFLICT DO NOTHING`), send, then set `sent` / `failed`;
  reclaim a stale `pending` row (crashed send) by age. Derive `period_start` from
  `users.last_digest_at`, so a frequency change never makes overlapping periods. Store only
  the sha-256 of the unsubscribe token; look users up by hash. A public unsubscribe or cron
  route is a change to `access-policy.ts` and needs the owner's sign-off plus its own auth
  (signed token / cron secret), per the ground rules.
- **CSV import** applies once: `UPDATE imports … WHERE status = 'previewed'` in the
  transaction that creates the issues (allocating numbers like `createIssue`). Keep the
  report small (CHECK < 1 MB) and never store the file.
  Built (slice B): the browser parses the file (`lib/imports/csv.ts`, our own RFC 4180
  reader) and sends only the mapped cells; `services/imports.ts` claims the import and
  creates labels (statement 1), then numbers all rows with ONE `issue_counter` bump
  (statement 2, gated on `xmin`), in one transaction. Export later must write cells
  through `escapeCsvCell` (CSV injection).
- **Retro and release-notes docs** use the seeded built-in templates (`retro`,
  `release_notes`, `postmortem`); `sprints.retro_doc_id`, `releases.notes_doc_id` and
  `incidents.postmortem_doc_id` are set null only on a hard delete, so treat a soft-deleted
  doc as missing when reading them.
- **Roadmap dates** (slice A) are written with `updateIssueField` field `schedule`
  (`{ startDate, dueDate }`, start ≤ due): one statement, one `startDate` / `dueDate`
  activity row per changed date; the plain `dueDate` field refuses a date before the start.
  The sprint retro (`services/sprint-retros.ts`) runs right after the completion's
  transaction, idempotently (docs-tree lock + sprint row lock, then "no live retro yet");
  reuse `ensureRetro` rather than inserting retro docs elsewhere.
- **Slice C as built.** `lib/service-registry/secrets.ts` is the "No secrets" heuristic
  (credential URLs, token prefixes, `password=…`, 32+ char hex/base64): the Zod schemas run
  it on every field and `assertNoSecrets` repeats it in the service. Declaring an incident
  passes the services, the first timeline entry and the commander's bell entry to
  `allocateIncidentNumber` as `extraCtes` (one statement). The postmortem is created under
  the `hq.docs_tree:<projectId>` lock in a `RunAtomic`, under a root "Postmortems" page.
  INC-1 lets people edit and delete their own `note`/`action` timeline entries (logged as
  `timeline_edited` / `timeline_deleted` activity); `status_change` entries stay as written.

## Handbook slice notes

**Handbook status: both slices (docs UX and handbook two-way sync) are done and merged** on
top of migration 0006, without a migration of their own. Where they meet: the sync status
badge and the "Publish to handbook" / "Review & pull" actions live in the docs-UX header
registries (read and edit mode alike); the sync state rides on `docQueries.getDoc`, so the
doc page is still ONE round trip; restore (DOC-10) and supersede (ADR-3) bump the version,
so a synced doc turns "Changed in HQ"; the history panel and the publish / pull dialogs draw
diffs with the same `LineDiffView`. `handbook-doc-actions.test.tsx` and the "docs UX seams"
cases of `handbook.db.test.ts` pin these seams; keep them green. The text below is the
original split, kept as the map of who owns what.

The handbook foundation (migration 0006) prepared two slices: **docs UX** and **handbook
two-way sync** (`Stockkart/engineering-handbook` is public and also edited by PRs directly:
HQ → repo goes through PRs a GitHub App opens; repo → HQ is detected from push webhooks).
Neither adds a migration. Shared pieces, already built and tested — use them, do not fork:

- `lib/markdown/from-rich-text.ts` (`richTextToMarkdown`, `normalizeForMarkdown`; see README
  "Markdown export" for the mapping and the lossy cases) and the importer
  `lib/markdown/to-rich-text.ts`, which reads the export's shapes back (callouts, the
  HQ-only-links comment). Keep the round-trip tests green when touching either.
- `lib/docs/markdown-export.ts` (`docToMarkdown`: `# Title`, ADR title and Status from the
  columns) and `services/doc-export.ts` (`docExportQueries.markdownFile`).
- `lib/docs/handbook-path.ts` (`handbookPathFor`, `isHandbookPath`): never write a repo
  path that did not pass `isHandbookPath`.
- `lib/text/line-diff.ts` (`lineDiff`: Myers line diff, our own, no dependency; hunks
  `equal|add|remove` with `collapsed` context runs).
- `lib/handbook/constants.ts` (publication states, sha / branch / PR URL / error-code formats).
- The route `app/(app)/[projectKey]/docs/[id]/export/route.ts` (DOC-12 download).

| Slice                              | Owns                                                                                                                                                                                                                                                                                          | Touches (append-only)                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs UX (DOC-10, ADR-3, DOC-12 UI) | the doc page layout (`app/(app)/[projectKey]/docs/[id]/page.tsx`, `features/docs/` page components), read/edit mode, the versions panel (diff via `lineDiff` of exported Markdown), the supersede flow, the "Export .md" button                                                               | `services/doc-queries.ts`, `actions/docs.ts` (supersede)                                                                                                                        |
| Handbook sync (DOC-14)             | the GitHub App client (`server/handbook/`), publish/pull services (`services/handbook-*.ts`, `actions/handbook.ts`), webhook handling for the handbook repo, the settings "Handbook" tab (`features/settings/project/handbook/`), doc sync status components (`features/docs/handbook-sync/`) | `env.ts` + `.env.example` (App id/key, repo), `app/api/webhooks/github` (route the handbook repo's pushes), the settings tab list, one slot on the doc page for the sync status |

Rules for the sync slice:

- **Both directions are optimistic.** Publish exports `docs.version` and records
  `doc_version`; on merge set `handbook_blob_sha`, `handbook_synced_version` and
  `handbook_synced_at` in one UPDATE. A push webhook only updates `handbook_remote_sha` /
  `handbook_remote_seen_at`; a pull applies the file like the importer does (version + 1 and
  a snapshot, `WHERE version = base`), never silently over an HQ edit made since the last
  sync (that is a conflict to show, both ways).
- One open publication per doc is enforced by the database (see "Database"); catch the
  unique violation on `handbook_publication_docs_one_open_per_doc` and report "already being
  published". Doc and publication in the same project is the app's check.
- **Which doc owns a repo file** is `coalesce(handbook_path, source_path)` on live docs
  (case-insensitive unique index). Pulls and webhooks must resolve files by that, not by
  `source_path` alone (the importer's key): a doc whose `handbook_path` moved keeps its old
  `source_path`, and another doc may now own that file. Persist the default path into
  `handbook_path` on first publish, so the index covers it.
- Default paths never take a GitHub-special top-level name (`README`, `LICENSE`,
  `SECURITY`, `CONTRIBUTING` … get `_DOC`); an explicit `handbook_path` may, so the publish
  UI should confirm before writing `README.md`, `decisions/0000-template.md` or such.
- **Public repo.** The serializer writes @mentions as `@Display Name` (which may also ping a
  same-named GitHub user) and HQ ids in `/api/files/<id>` and `/<KEY>/…` links. Decide in the
  publish UI whether to warn about or strip them before the first PR; nothing is published
  automatically.
- Branches are `hq/…` only; the App never pushes to the default branch or to a branch a
  person made. Never log the App's private key or installation tokens; `error_code` holds a
  short code, never a response body.
- Webhooks: verify the signature first (as `server/github/` does) and dedupe by delivery id.
- The handbook repo is public: export only what the doc already says (no internal ids beyond
  the HQ links the serializer writes, no emails, no attachment URLs that bypass HQ auth).

Docs UX as built (no migration):

- **Doc page** = `features/docs/doc-screen.tsx` (client) under `docs/[id]/page.tsx`, still ONE
  round trip (`docs-ux.db.test.ts` and `handbook.db.test.ts` count it; add any new page read
  there and to both tests).
  Read mode renders `RichTextView` (no Tiptap loaded); `?edit=1` mounts `DocEditor`, which
  only holds the edit body and is driven through `controllerRef` (`flush`, `saveVersion`,
  `mine`). "Done" = `Autosaver.flush()`, then read mode; a save that did not land asks first.
  `E`, `[`, Esc and ⌘/Ctrl+Enter are in `features/shell/shortcuts.ts` (scope "Docs").
- No persistent tree: `pages-nav.tsx` (drawer + pinned column, `localStorage` key
  `hq.docs.pages`). The docs index page renders the full `DocTree` itself; the docs layout no
  longer reads the tree.
- Side panels open one at a time; `DocCommentsPanel` stays mounted while hidden (`visible`,
  `onActivate`) so comment requests from the editor and from read mode reach it.
- **Inline comments from read mode**: `doc-read-view.tsx` tags text leaves for the view only
  (`tagTextLeaves`, mark `hqTextLeaf`, renderer `renderers/text-leaf.tsx`; never saved), maps
  the selection to `{ leaf, from, to }`, adds the anchor with `addAnchorMark`
  (`lib/docs/anchor-marks.ts`) and saves with `saveDocAction` on the shown version (§7.4);
  only then does it send the usual `hq:comment-anchor-request`. A conflict refreshes, never
  overwrites.
- **DOC-10**: `docService.restoreVersion` = `lockedSave` (shared with `saveDoc`) with the old
  title and content, `snapshot: true` and an activity row `restored` (field `version`, from =
  restored version, to = new version). `restoredContent` keeps anchors of live threads and
  re-anchors current threads whose exact text exists in the old version. The diff is
  `lineDiff` over `# title` + `richTextToMarkdown` (`history/`), drawn by
  `features/docs/diff/line-diff-view.tsx` (`LineDiffView`, also the publish / pull dialogs'
  renderer: one component, do not fork it); version contents load on open
  (`loadDocVersionAction`), never with the page.
- **ADR-3**: `docService.supersedeAdr` is ONE statement: `UPDATE` the old ADR (gated on "not
  superseded yet"; it bumps `version`, since the status is in the export) first, then the
  insert gated on it (FK to the new id checked at statement end), activity on both
  (`adrStatus`, `adrSupersededBy` on the old; `supersedes` on the new). Numbering is
  `allocateAdr`, shared with `createAdr`.

**Header registries** (one line each to add an entry; the handbook sync uses both):

- `features/docs/doc-actions/index.ts` → `DOC_ACTIONS` (above the delete line):
  `types.ts` descriptors with `id`, `label`, `visible?`, `disabledReason?` (shown, not
  selectable, with the reason), and `run` or a `dialog` (props: `context`, `open`,
  `onOpenChange`). `context.flush()` saves pending edits, `context.toReadMode()` leaves edit
  mode like "Done", `context.current()` is the copy on screen, `context.doc.version` is the
  latest version saved on the page. Ids are checked unique at load.
- `features/docs/doc-header-badges/index.tsx` → `DOC_HEADER_BADGES`: `{ id, Badge }` where
  `Badge` takes `{ doc: DocDetail }` (render null when there is nothing to say). Fields a
  badge needs go into `docQueries.getDoc` (same query, so still one round trip), as
  `DocDetail.handbook` does.

**Sync slice as built (DOC-14).** README "Engineering handbook sync" has the setup, statuses
and conflict rules; keep these seams intact:

- `server/handbook/github-app.ts` is the ONLY GitHub API client (fetch, no SDK). Every URL is
  built and re-checked there (token endpoint or `/repos/<HANDBOOK_REPO>/…`), every path passes
  `isHandbookPath`, writes go to `hq/…` branches only. `server/handbook/index.ts` wires it
  from env; tests use `test/handbook-fakes.ts` (an in-memory repo) or a fetch fake.
- Status is derived by `lib/handbook/sync-state.ts` from stored columns (`handbookSyncStatus`).
  `docs.handbook_remote_sha = GIT_NULL_SHA` (40 zeros) means **removed** on the default
  branch; `NULL` with a `handbook_remote_seen_at` means **changed, blob unknown** (a push
  touched it). This refines the foundation's "seen-at without a sha = absent" without a
  migration.
- Webhook: `server/handbook/webhook-plan.ts` (pure) adds `plan.handbook` after the signature,
  payload and org checks; `applyDelivery` writes it in its ONE deduped statement (`hb_*`
  CTEs). Never call GitHub there. HQ's commits carry an `HQ-Publication: <branch>` trailer so
  the push of its own merge is not drift (only while that publication is open or merged
  within the hour). A merge also matches a `failed` publication by branch (its PR was opened
  by a request that timed out) and takes the PR number and URL from the payload.
- Publish (`services/handbook-publish.ts`) claims the publication (`open`, no PR yet) in one
  statement BEFORE calling GitHub, then records the PR + activity, or `failed` + `error_code`
  (and puts back the paths it pinned). A claim left without a PR for 15 minutes is failed by
  the next publish of its docs.
- "Check handbook now" is rate-limited through `login_attempts` rows keyed
  `handbook_check:<projectId>` with `success = true` (shared across instances; never counted
  as failed sign-ins, which use `email:` / `ip:` keys and `NOT success`).
- **On the doc page** (no temporary mount any more): `DocDetail.handbook` comes from
  `docQueries.getDoc` (the `handbookSyncColumns` + open-publication joins shared with
  `handbookQueries`), so there is no extra read; `page.tsx` passes `handbookConfigured()`
  (env only). `HandbookHeaderBadge` is in `DOC_HEADER_BADGES` and recomputes the status for
  the version saved on the page (`statusAtVersion`); `publishToHandbookAction` /
  `pullFromHandbookAction` (`handbook-doc-actions.tsx`) are in `DOC_ACTIONS`. Publish never
  sends unsaved content: the server exports the stored `docs.version`, the dialog runs
  `context.flush()` before its preview ("Save first" if that fails or an upload is still
  running), and the publish carries the previewed version (`expectedVersion`), refused with
  `PREVIEW_STALE_MESSAGE` if the doc was saved again since. Pull runs
  `context.toReadMode()` first, so the applied version shows in read mode and no editor is
  left on the old version.

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
