import { type SQL, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonical-json";
import { extractUserMentionIds } from "@/lib/mentions";
import {
  RELEASE_ACTIONS,
  RELEASE_NOTES_PARENT_TITLE,
  releaseNotesTitle,
} from "@/lib/releases/constants";
import { buildReleaseNotes } from "@/lib/releases/notes";
import {
  type createReleaseInput,
  type deleteReleaseInput,
  type markReleasedInput,
  type updateReleaseInput,
} from "@/lib/releases/schemas";
import { type GeneratedNotes, type NotesOutcome } from "@/lib/releases/views";
import { extractPlainText, rt, type RichTextDoc } from "@/lib/rich-text";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { allInOrder } from "./parallel";
import { createReleaseQueries } from "./release-queries";
import {
  docRefs,
  jsonbOrNull,
  mentionSyncCtes,
  mentionSyncStatement,
  rowsOf,
  userMentionSyncStatement,
} from "./sql";

export type CreateReleaseData = z.output<typeof createReleaseInput>;
export type UpdateReleaseData = z.output<typeof updateReleaseInput>;
export type DeleteReleaseData = z.output<typeof deleteReleaseInput>;
export type MarkReleasedData = z.output<typeof markReleasedInput>;
export type { GeneratedNotes, NotesOutcome };

export interface ReleaseServiceOptions {
  /** Statements that must see an earlier statement's row lock (see `RunAtomic`). */
  runAtomic: RunAtomic;
  read?: Read;
}

/** The unique index behind "names are unique per project" (REL-1). */
const NAME_UNIQUE = "releases_project_name_unique";

/** Archived projects are read-only. */
const liveProject = sql`project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`;

/** The row lock every lifecycle change takes first (its own statement, see `RunAtomic`). */
const lockRelease = (releaseId: string) =>
  sql`SELECT id FROM releases WHERE id = ${releaseId}::uuid AND ${liveProject} FOR UPDATE`;

/** Several releases' locks, always in id order, so two crossing moves cannot deadlock. */
const lockReleases = (releaseIds: readonly string[]) =>
  sql`SELECT id FROM releases
    WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(releaseIds)}::jsonb))
      AND ${liveProject}
    ORDER BY id FOR UPDATE`;

/**
 * The docs tree lock of `services/docs.ts` (same key), so creating the "Release notes"
 * parent page cannot race a move or delete in the tree, or a second generation.
 */
const docsTreeLock = (projectId: string) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hq.docs_tree:${projectId}`}, 0))`;

const generationMeta = z.object({ docId: z.string(), version: z.number() });

const releaseRow = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  release_date: z.string().nullable(),
  released_ms: z.number().nullable(),
  doc_id: z.string().nullable(),
  doc_version: z.number().nullable(),
  doc_title: z.string().nullable(),
  doc_content: z.unknown(),
  last_generation: z.unknown(),
  template_id: z.string().nullable(),
  parent_id: z.string().nullable(),
  last_root_position: z.string().nullable(),
  last_child_position: z.string().nullable(),
});

/**
 * Release lifecycle (REL-1) and release notes (REL-2). Every write logs `activity` on
 * `entity_type = 'release'` (one row per changed field) and, for issues it touches, an
 * `updated`/`release` row per issue (from → to release id), like every fix-version change.
 *
 * `state` and `released_at` are written together in one UPDATE (the DB CHECK pairs them).
 */
export function createReleaseService(db: AppDatabase, options: ReleaseServiceOptions) {
  const read = options.read ?? directRead;
  const queries = createReleaseQueries(db, { read });

  async function allProjectKeys(): Promise<string[]> {
    const rows = rowsOf(
      await read(db.execute(sql`SELECT key FROM projects`)),
      z.object({ key: z.string() }),
    );
    return rows.map((row) => row.key);
  }

  function uniqueName(error: unknown, name: string): never {
    const info = pgErrorInfo(error);
    if (info?.code === UNIQUE_VIOLATION && info.constraint === NAME_UNIQUE) {
      throw conflict(`A release named “${name}” already exists in this project`);
    }
    throw error;
  }

  /** Everything "Generate release notes" needs, in one round trip. */
  async function notesInputs(releaseId: string) {
    const project = sql`(SELECT project_id FROM releases WHERE id = ${releaseId}::uuid)`;
    const parent = sql`(
      SELECT id FROM docs WHERE project_id = ${project} AND parent_id IS NULL
        AND title = ${RELEASE_NOTES_PARENT_TITLE} AND deleted_at IS NULL
      ORDER BY position, id LIMIT 1
    )`;
    const [releaseResult, projectKeys] = await allInOrder([
      read(
        db.execute(sql`
          SELECT r.id, r.project_id, r.name, r.release_date::text AS release_date,
            floor(extract(epoch FROM r.released_at) * 1000)::float8 AS released_ms,
            d.id::text AS doc_id, d.version AS doc_version, d.title AS doc_title,
            d.content AS doc_content,
            (SELECT a.meta FROM activity a
              WHERE a.entity_type = 'release' AND a.entity_id = r.id
                AND a.action = ${RELEASE_ACTIONS.notesGenerated}
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_generation,
            (SELECT t.id::text FROM templates t
              WHERE t.kind = 'doc' AND t.subtype = 'release_notes' AND t.built_in
              LIMIT 1) AS template_id,
            ${parent}::text AS parent_id,
            (SELECT max(position) FROM docs WHERE project_id = r.project_id
              AND parent_id IS NULL AND deleted_at IS NULL) AS last_root_position,
            (SELECT max(position) FROM docs WHERE parent_id = ${parent}
              AND deleted_at IS NULL) AS last_child_position
          FROM releases r
          -- A trashed notes doc counts as none: generating makes a new one.
          LEFT JOIN docs d ON d.id = r.notes_doc_id AND d.deleted_at IS NULL
          WHERE r.id = ${releaseId}::uuid
            AND r.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)
        `),
      ),
      allProjectKeys(),
    ]);
    const [row] = rowsOf(releaseResult, releaseRow);
    if (!row) throw notFound("Release");
    const issues = await queries.listReleaseIssues(row.project_id, releaseId);
    return { row, issues, projectKeys };
  }

  /** REL-2 create path: the notes doc (and its parent page if missing), in one transaction. */
  async function createNotesDoc(
    actorId: string,
    input: {
      releaseId: string;
      projectId: string;
      title: string;
      content: RichTextDoc;
      templateId: string | null;
      parentId: string | null;
      lastRootPosition: string | null;
      lastChildPosition: string | null;
      projectKeys: string[];
    },
  ): Promise<string | null> {
    const docId = crypto.randomUUID();
    const parentDocId = crypto.randomUUID();
    const parentContent = rt.doc(
      rt.paragraph(
        "Release notes generated from each release (Releases → Generate release notes).",
      ),
    );
    // Positions from the read before the lock; a racing create may tie, which the docs
    // tree tolerates (positions are not unique, see `services/docs.ts`).
    const parentPosition = generateKeyBetween(input.lastRootPosition, null);
    const childPosition = generateKeyBetween(input.parentId ? input.lastChildPosition : null, null);
    const statement = sql`
      WITH rel AS (
        -- Idempotent: only while the release has no live notes doc (a concurrent
        -- generation that won the tree lock has set one; then this inserts nothing).
        SELECT r.id FROM releases r
        WHERE r.id = ${input.releaseId}::uuid AND r.project_id = ${input.projectId}::uuid
          AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.id = r.notes_doc_id AND d.deleted_at IS NULL)
        FOR UPDATE
      ),
      existing_parent AS (
        SELECT id FROM docs
        WHERE project_id = ${input.projectId}::uuid AND parent_id IS NULL
          AND title = ${RELEASE_NOTES_PARENT_TITLE} AND deleted_at IS NULL
        ORDER BY position, id LIMIT 1
      ),
      new_parent AS (
        INSERT INTO docs (id, project_id, type, title, content, content_text, owner_id,
          updated_by, position)
        SELECT ${parentDocId}::uuid, ${input.projectId}::uuid, 'page', ${RELEASE_NOTES_PARENT_TITLE},
          ${jsonbOrNull(parentContent)}, ${extractPlainText(parentContent)}, ${actorId}::uuid,
          ${actorId}::uuid, ${parentPosition}
        WHERE EXISTS (SELECT 1 FROM rel) AND NOT EXISTS (SELECT 1 FROM existing_parent)
        RETURNING id, version, title, content
      ),
      new_parent_version AS (
        INSERT INTO doc_versions (doc_id, version, title, content, author_id)
        SELECT id, version, title, content, ${actorId}::uuid FROM new_parent
      ),
      new_parent_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
        SELECT 'doc', id, ${actorId}::uuid, 'created', 'page' FROM new_parent
      ),
      parent AS (
        SELECT id FROM existing_parent UNION ALL SELECT id FROM new_parent LIMIT 1
      ),
      inserted AS (
        INSERT INTO docs (id, project_id, parent_id, type, title, content, content_text,
          owner_id, updated_by, position, template_id)
        SELECT ${docId}::uuid, ${input.projectId}::uuid, (SELECT id FROM parent),
          'release_notes', ${input.title}, ${jsonbOrNull(input.content)},
          ${extractPlainText(input.content)}, ${actorId}::uuid, ${actorId}::uuid,
          ${childPosition}, ${input.templateId}::uuid
        FROM rel
        RETURNING id, version, title, content
      ),
      first_version AS (
        INSERT INTO doc_versions (doc_id, version, title, content, author_id)
        SELECT id, version, title, content, ${actorId}::uuid FROM inserted
      ),
      created_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
        SELECT 'doc', id, ${actorId}::uuid, 'created', 'release_notes' FROM inserted
      ),
      ${mentionSyncCtes({
        // Safe inline: the doc is new, so no other request can be syncing it.
        fromType: "doc",
        fromId: docId,
        refs: docRefs(input.content, input.projectKeys),
        actorId,
        gate: sql`EXISTS (SELECT 1 FROM inserted)`,
      })},
      linked AS (
        UPDATE releases SET notes_doc_id = inserted.id, updated_at = now()
        FROM inserted WHERE releases.id = ${input.releaseId}::uuid
      ),
      logged AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value, meta)
        SELECT 'release', ${input.releaseId}::uuid, ${actorId}::uuid,
          ${RELEASE_ACTIONS.notesGenerated}, 'notesDoc', inserted.id::text,
          jsonb_build_object('docId', inserted.id::text, 'version', inserted.version)
        FROM inserted
      )
      SELECT id::text FROM inserted
    `;
    const results = await options.runAtomic([docsTreeLock(input.projectId), statement]);
    const [row] = rowsOf(results.at(-1), z.object({ id: z.string() }));
    return row?.id ?? null;
  }

  /**
   * REL-2 update path, the docs optimistic-lock path (`UPDATE … WHERE version = base`, as
   * `saveDoc`): a new version with the regenerated content and a snapshot of it. When the
   * doc was edited since the last generation (`preserveEdits`), the edited state is first
   * kept as a snapshot of its own version, so nothing a person wrote is lost. Returns null
   * when someone saved meanwhile (the version moved on).
   */
  async function rewriteNotesDoc(
    actorId: string,
    input: {
      releaseId: string;
      docId: string;
      baseVersion: number;
      title: string;
      content: RichTextDoc;
      projectKeys: string[];
      preserveEdits: boolean;
    },
  ): Promise<number | null> {
    const preserve = sql`
      INSERT INTO doc_versions (doc_id, version, title, content, author_id)
      SELECT id, version, title, content, updated_by FROM docs
      WHERE id = ${input.docId}::uuid AND version = ${input.baseVersion}::int
        AND deleted_at IS NULL
      ON CONFLICT (doc_id, version) DO NOTHING
    `;
    const write = sql`
      WITH updated AS (
        UPDATE docs SET content = ${jsonbOrNull(input.content)},
          content_text = ${extractPlainText(input.content)}, title = ${input.title},
          version = version + 1, updated_by = ${actorId}::uuid, updated_at = now()
        WHERE id = ${input.docId}::uuid AND version = ${input.baseVersion}::int
          AND deleted_at IS NULL
        RETURNING id, version, title, content
      ),
      snapshot AS (
        INSERT INTO doc_versions (doc_id, version, title, content, author_id)
        SELECT id, version, title, content, ${actorId}::uuid FROM updated
      ),
      logged AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value, meta)
        SELECT 'release', ${input.releaseId}::uuid, ${actorId}::uuid,
          ${RELEASE_ACTIONS.notesGenerated}, 'notesDoc', id::text,
          jsonb_build_object('docId', id::text, 'version', version)
        FROM updated
      )
      SELECT version FROM updated
    `;
    const writtenHere = sql`EXISTS (SELECT 1 FROM docs WHERE id = ${input.docId}::uuid
        AND xmin = pg_current_xact_id()::xid)`;
    // DOC-9 links follow the new text; only if THIS transaction wrote the doc (xmin gate,
    // as in `saveDoc`), so a lost race never replaces the winner's links. The @user links
    // too (a person's edits may have mentioned someone); nobody is notified by a rewrite.
    const sync = mentionSyncStatement({
      fromType: "doc",
      fromId: input.docId,
      refs: docRefs(input.content, input.projectKeys),
      actorId,
      gate: writtenHere,
    });
    const userSync = userMentionSyncStatement({
      fromType: "doc",
      fromId: input.docId,
      userIds: extractUserMentionIds(input.content),
      actorId,
      gate: writtenHere,
    });
    const statements: [SQL, ...SQL[]] = input.preserveEdits
      ? [preserve, write, sync, userSync]
      : [write, sync, userSync];
    const results = await options.runAtomic(statements);
    const writeResult = results[input.preserveEdits ? 1 : 0];
    const [row] = rowsOf(writeResult, z.object({ version: z.number() }));
    return row?.version ?? null;
  }

  return {
    async createRelease(actorId: string, input: CreateReleaseData): Promise<{ id: string }> {
      try {
        const result = await db.execute(sql`
          WITH project AS (
            SELECT id FROM projects WHERE key = ${input.projectKey} AND archived_at IS NULL
          ),
          inserted AS (
            INSERT INTO releases (project_id, name, description, release_date)
            SELECT id, ${input.name}, ${input.description}, ${input.releaseDate}::date
            FROM project
            RETURNING id, name
          ),
          logged AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
            SELECT 'release', id, ${actorId}::uuid, ${RELEASE_ACTIONS.created},
              jsonb_build_object('name', name, 'releaseDate', ${input.releaseDate}::text)
            FROM inserted
          )
          SELECT id::text FROM inserted
        `);
        const [row] = rowsOf(result, z.object({ id: z.string() }));
        if (!row) throw notFound(`Project ${input.projectKey}`);
        return row;
      } catch (error) {
        return uniqueName(error, input.name);
      }
    },

    /** Name, target date and description; one activity row per field that changed. */
    async updateRelease(actorId: string, input: UpdateReleaseData): Promise<void> {
      let updated: number;
      try {
        const result = await db.execute(sql`
          WITH old AS (
            SELECT id, name, release_date::text AS release_date, description FROM releases
            WHERE id = ${input.releaseId}::uuid AND ${liveProject}
            FOR UPDATE
          ),
          updated AS (
            UPDATE releases r SET name = ${input.name}, release_date = ${input.releaseDate}::date,
              description = ${input.description}, updated_at = now()
            FROM old WHERE r.id = old.id
            RETURNING r.id
          ),
          logged AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'release', old.id, ${actorId}::uuid, ${RELEASE_ACTIONS.updated}, f.field,
              f.from_value, f.to_value
            FROM old, LATERAL (VALUES
              ('name', old.name, ${input.name}::text),
              ('releaseDate', old.release_date, ${input.releaseDate}::text),
              ('description', old.description, ${input.description}::text)
            ) AS f(field, from_value, to_value)
            WHERE f.from_value IS DISTINCT FROM f.to_value AND EXISTS (SELECT 1 FROM updated)
          )
          SELECT count(*)::int AS updated FROM updated
        `);
        updated = rowsOf(result, z.object({ updated: z.number() }))[0]?.updated ?? 0;
      } catch (error) {
        uniqueName(error, input.name);
      }
      if (updated === 0) throw notFound("Release");
    },

    /**
     * REL-1: only an unreleased release, and only without live issues unless `unsetIssues`
     * (then the fix version is cleared on them first, one activity row each). Trashed issues
     * lose the fix version too (logged), so a restore never points at a missing release.
     *
     * Two statements in one transaction: the first row-locks the release (fix-version writes
     * share-lock it), so the second counts the issues AFTER every racing assignment.
     */
    async deleteRelease(actorId: string, input: DeleteReleaseData): Promise<{ cleared: number }> {
      const id = input.releaseId;
      const remove = sql`
        WITH target AS (
          SELECT id, name, state FROM releases WHERE id = ${id}::uuid AND ${liveProject}
        ),
        live_issues AS (
          SELECT count(*)::int AS n FROM issues
          WHERE release_id = ${id}::uuid AND deleted_at IS NULL
        ),
        allowed AS (
          SELECT t.id, t.name FROM target t
          WHERE t.state = 'unreleased'
            AND (${input.unsetIssues}::boolean OR (SELECT n FROM live_issues) = 0)
        ),
        cleared AS (
          UPDATE issues SET release_id = NULL, updated_at = now()
          WHERE release_id IN (SELECT id FROM allowed)
          RETURNING id, deleted_at
        ),
        cleared_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value, meta)
          SELECT 'issue', id, ${actorId}::uuid, 'updated', 'release', ${id}::text, NULL,
            jsonb_build_object('reason', 'release_deleted',
              'fromName', (SELECT name FROM allowed))
          FROM cleared
        ),
        deleted AS (
          DELETE FROM releases WHERE id IN (SELECT id FROM allowed) RETURNING id
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
          SELECT 'release', a.id, ${actorId}::uuid, ${RELEASE_ACTIONS.deleted},
            jsonb_build_object('name', a.name,
              'issueIds', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM cleared), '[]'::jsonb))
          FROM allowed a WHERE EXISTS (SELECT 1 FROM deleted)
        )
        SELECT (SELECT state::text FROM target) AS state,
          (SELECT n FROM live_issues) AS live,
          (SELECT count(*)::int FROM deleted) AS deleted,
          (SELECT count(*)::int FROM cleared WHERE deleted_at IS NULL) AS cleared
      `;
      const results = await options.runAtomic([lockRelease(id), remove]);
      const [row] = rowsOf(
        results.at(-1),
        z.object({
          state: z.string().nullable(),
          live: z.number(),
          deleted: z.number(),
          cleared: z.number(),
        }),
      );
      if (!row || row.state === null) throw notFound("Release");
      if (row.deleted === 0) {
        if (row.state === "released") {
          throw invalid("A released release cannot be deleted; reopen it first");
        }
        throw conflict(
          `${row.live} ${row.live === 1 ? "issue has" : "issues have"} this fix version; unset it on them first`,
        );
      }
      return { cleared: row.cleared };
    },

    /**
     * REL-1 "Mark released": `state = 'released'` and `released_at = now()` in one UPDATE.
     * Open (not done-category) live issues refuse it unless the caller chose what to do:
     * `keep` releases anyway, `move` first moves them to another unreleased release of the
     * project (one activity row each). Same two-statement lock as `deleteRelease`.
     */
    async markReleased(
      actorId: string,
      input: MarkReleasedData,
    ): Promise<{ moved: number; openIssues: number }> {
      const id = input.releaseId;
      const action = input.openIssues?.action ?? "none";
      const targetId =
        input.openIssues?.action === "move" ? input.openIssues.targetReleaseId : null;
      const release = sql`
        WITH target AS (
          SELECT id, project_id, state FROM releases WHERE id = ${id}::uuid AND ${liveProject}
        ),
        open_issues AS (
          SELECT i.id FROM issues i JOIN statuses st ON st.id = i.status_id
          WHERE i.release_id = ${id}::uuid AND i.deleted_at IS NULL AND st.category <> 'done'
          FOR UPDATE OF i
        ),
        dest AS (
          SELECT r.id FROM releases r
          WHERE r.id = ${targetId}::uuid AND r.id <> ${id}::uuid AND r.state = 'unreleased'
            AND r.project_id = (SELECT project_id FROM target)
          FOR SHARE
        ),
        go AS (
          SELECT t.id FROM target t
          WHERE t.state = 'unreleased' AND (
            NOT EXISTS (SELECT 1 FROM open_issues)
            OR ${action}::text = 'keep'
            OR (${action}::text = 'move' AND EXISTS (SELECT 1 FROM dest)))
        ),
        moved AS (
          UPDATE issues SET release_id = (SELECT id FROM dest), updated_at = now()
          WHERE id IN (SELECT id FROM open_issues) AND ${action}::text = 'move'
            AND EXISTS (SELECT 1 FROM go) AND EXISTS (SELECT 1 FROM dest)
          RETURNING id, release_id
        ),
        moved_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'issue', id, ${actorId}::uuid, 'updated', 'release', ${id}::text,
            release_id::text
          FROM moved
        ),
        released AS (
          UPDATE releases SET state = 'released', released_at = now(), updated_at = now()
          WHERE id IN (SELECT id FROM go)
          RETURNING id
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value, meta)
          SELECT 'release', id, ${actorId}::uuid, ${RELEASE_ACTIONS.released}, 'state',
            'unreleased', 'released',
            jsonb_build_object('openIssues', (SELECT count(*) FROM open_issues),
              'moved', (SELECT count(*) FROM moved), 'movedTo', (SELECT id FROM dest))
          FROM released
        )
        SELECT (SELECT state::text FROM target) AS state,
          (SELECT count(*)::int FROM open_issues) AS open,
          EXISTS (SELECT 1 FROM dest) AS dest_ok,
          (SELECT count(*)::int FROM released) AS released,
          (SELECT count(*)::int FROM moved) AS moved
      `;
      // Both releases are locked first, in id order: two crossing "release A, move to B" /
      // "release B, move to A" calls queue instead of deadlocking. (A deadlock with an issue
      // write, which locks the issue before the release, is mapped by `runAction`.)
      const results = await options.runAtomic([
        lockReleases(targetId ? [id, targetId] : [id]),
        release,
      ]);
      const [row] = rowsOf(
        results.at(-1),
        z.object({
          state: z.string().nullable(),
          open: z.number(),
          dest_ok: z.boolean(),
          released: z.number(),
          moved: z.number(),
        }),
      );
      if (!row || row.state === null) throw notFound("Release");
      if (row.released === 0) {
        if (row.state === "released") throw invalid("This release is already released");
        if (action === "move" && !row.dest_ok) {
          throw notFound("Unreleased target release");
        }
        throw conflict(
          `${row.open} ${row.open === 1 ? "issue is" : "issues are"} not done yet; move ${row.open === 1 ? "it" : "them"} or release anyway`,
        );
      }
      return { moved: row.moved, openIssues: row.open };
    },

    /** REL-1 "Reopen": back to unreleased, `released_at` cleared in the same UPDATE. */
    async reopenRelease(actorId: string, releaseId: string): Promise<void> {
      const result = await db.execute(sql`
        WITH reopened AS (
          UPDATE releases SET state = 'unreleased', released_at = NULL, updated_at = now()
          WHERE id = ${releaseId}::uuid AND state = 'released' AND ${liveProject}
          RETURNING id
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'release', id, ${actorId}::uuid, ${RELEASE_ACTIONS.reopened}, 'state',
            'released', 'unreleased'
          FROM reopened
        )
        SELECT (SELECT count(*)::int FROM reopened) AS reopened,
          (SELECT state::text FROM releases WHERE id = ${releaseId}::uuid AND ${liveProject})
            AS state
      `);
      const [row] = rowsOf(
        result,
        z.object({ reopened: z.number(), state: z.string().nullable() }),
      );
      if (!row || row.state === null) throw notFound("Release");
      if (row.reopened === 0) throw invalid("Only a released release can be reopened");
    },

    /**
     * REL-2 "Generate release notes". Idempotent:
     * - no live notes doc → create it (under the "Release notes" page, made if missing) and
     *   set `releases.notes_doc_id`;
     * - the doc is exactly as the last generation left it (same id and version as that
     *   generation's activity row) → rewrite it in place, or nothing if the content is the
     *   same;
     * - the doc was edited since → a new version via the optimistic-lock path, the edited
     *   state kept as a version first.
     */
    async generateNotes(actorId: string, releaseId: string): Promise<GeneratedNotes> {
      const { row, issues, projectKeys } = await notesInputs(releaseId);
      const title = releaseNotesTitle(row.name);
      const content = buildReleaseNotes({
        name: row.name,
        releaseDate: row.release_date,
        releasedAt: row.released_ms === null ? null : new Date(row.released_ms),
        issues,
      });

      if (row.doc_id === null || row.doc_version === null) {
        const created = await createNotesDoc(actorId, {
          releaseId,
          projectId: row.project_id,
          title,
          content,
          templateId: row.template_id,
          parentId: row.parent_id,
          lastRootPosition: row.last_root_position,
          lastChildPosition: row.last_child_position,
          projectKeys,
        });
        if (created) return { docId: created, outcome: "created" };
        // A concurrent generation made the doc first: report that one.
        const again = await notesInputs(releaseId);
        if (!again.row.doc_id) throw conflict("Could not create the release notes; try again");
        return { docId: again.row.doc_id, outcome: "unchanged" };
      }

      const last = generationMeta.safeParse(row.last_generation);
      const untouched =
        last.success && last.data.docId === row.doc_id && last.data.version === row.doc_version;
      const same =
        row.doc_title === title && canonicalJson(row.doc_content) === canonicalJson(content);
      if (same) return { docId: row.doc_id, outcome: "unchanged" };
      const version = await rewriteNotesDoc(actorId, {
        releaseId,
        docId: row.doc_id,
        baseVersion: row.doc_version,
        title,
        content,
        projectKeys,
        preserveEdits: !untouched,
      });
      if (version === null) {
        // A concurrent generation (a double click) may have written exactly this already.
        const again = await notesInputs(releaseId);
        const done =
          again.row.doc_id === row.doc_id &&
          again.row.doc_title === title &&
          canonicalJson(again.row.doc_content) === canonicalJson(content);
        if (done) return { docId: row.doc_id, outcome: "unchanged" };
        throw conflict("Someone saved the release notes just now; try again");
      }
      return { docId: row.doc_id, outcome: untouched ? "updated" : "new_version" };
    },
  };
}

export type ReleaseService = ReturnType<typeof createReleaseService>;
