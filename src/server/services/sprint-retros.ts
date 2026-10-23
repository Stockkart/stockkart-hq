import { sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { formatIssueKey } from "@/lib/issues/keys";
import { extractPlainText, type RichTextDoc, richTextDocSchema } from "@/lib/rich-text";
import { SPRINT_ACTIONS, SPRINT_STATES, WONT_DO_STATUS_NAME } from "@/lib/sprints/constants";
import { buildRetroDoc, RETROS_PAGE_TITLE, retroTitle } from "@/lib/sprints/retro";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound } from "./errors";
import { docRefs, jsonbOrNull, mentionSyncCtes, rowsOf } from "./sql";

/** `activity` action on the sprint when its retro doc is created. */
export const RETRO_CREATED_ACTION = "retro_created";

const sprintRow = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  state: z.enum(SPRINT_STATES),
  project_id: z.string(),
  project_key: z.string(),
  auto_retro: z.boolean(),
  retro_doc_id: z.string().nullable(),
});
const issueRow = z.object({ number: z.number(), title: z.string(), points: z.number().nullable() });
const placeRow = z.object({
  parent_id: z.string().nullable(),
  root_last: z.string().nullable(),
  child_last: z.string().nullable(),
});

export interface EnsuredRetro {
  docId: string;
  /** False when the sprint already had a (live) retro doc. */
  created: boolean;
}

/**
 * SPR-5: the retro doc of a completed sprint, made from the built-in `retro` template
 * under the project's top-level "Retros" page (created when missing), titled
 * "Retro — <sprint>", and linked from `sprints.retro_doc_id`.
 *
 * It runs right after the completion's transaction, not inside it: the doc's content lists
 * the issues the completion carried over, which only exist once it has run, and Neon's HTTP
 * driver has no interactive transaction to build the content in between. Instead it is
 * idempotent: under the docs-tree lock and a row lock on the sprint, the write re-checks
 * that the sprint has no live retro, so a retry, a double click or a concurrent "Create
 * retro" never makes a second one. A soft-deleted retro counts as missing (AGENTS.md).
 */
export function createSprintRetroService(
  db: AppDatabase,
  options: { runAtomic: RunAtomic; read?: Read },
) {
  const read = options.read ?? directRead;

  async function sprintOf(sprintId: string) {
    const result = await read(
      db.execute(sql`
        SELECT s.id, s.name, s.goal, s.start_date::text AS start_date,
          s.end_date::text AS end_date, s.state::text AS state, s.project_id::text AS project_id,
          p.key AS project_key, p.auto_retro,
          (SELECT d.id::text FROM docs d WHERE d.id = s.retro_doc_id AND d.deleted_at IS NULL)
            AS retro_doc_id
        FROM sprints s JOIN projects p ON p.id = s.project_id
        WHERE s.id = ${sprintId}::uuid AND p.archived_at IS NULL
      `),
    );
    const [row] = rowsOf(result, sprintRow);
    if (!row) throw notFound("Sprint");
    return row;
  }

  /**
   * The issues the (latest) completion counted as done (`completedIssueIds`), so a retro
   * made later lists what the completion did; completions logged before that key existed
   * fall back to the sprint's done (not Won't Do) live issues.
   */
  async function completedIssues(sprintId: string) {
    const result = await read(
      db.execute(sql`
        WITH completed AS (
          SELECT meta -> 'completedIssueIds' AS ids FROM activity
          WHERE entity_type = 'sprint' AND entity_id = ${sprintId}::uuid
            AND action = ${SPRINT_ACTIONS.completed}
          ORDER BY created_at DESC
          LIMIT 1
        )
        SELECT i.number, i.title, i.story_points AS points
        FROM issues i JOIN statuses st ON st.id = i.status_id
        WHERE i.deleted_at IS NULL AND CASE
          WHEN (SELECT ids FROM completed) IS NOT NULL THEN i.id IN (
            SELECT (jsonb_array_elements_text((SELECT ids FROM completed)))::uuid)
          ELSE i.sprint_id = ${sprintId}::uuid
            AND st.category = 'done' AND st.name <> ${WONT_DO_STATUS_NAME}
        END
        ORDER BY i.number
      `),
    );
    return rowsOf(result, issueRow);
  }

  /** The live issues the (latest) completion carried out of the sprint, by number. */
  async function carriedIssues(sprintId: string) {
    const result = await read(
      db.execute(sql`
        SELECT i.number, i.title, i.story_points AS points
        FROM (
          SELECT meta FROM activity
          WHERE entity_type = 'sprint' AND entity_id = ${sprintId}::uuid
            AND action = ${SPRINT_ACTIONS.completed}
          ORDER BY created_at DESC
          LIMIT 1
        ) completed,
        LATERAL jsonb_array_elements_text(
          COALESCE(completed.meta -> 'carriedIssueIds', '[]'::jsonb)) AS carried(id)
        JOIN issues i ON i.id = carried.id::uuid AND i.deleted_at IS NULL
        ORDER BY i.number
      `),
    );
    return rowsOf(result, issueRow);
  }

  async function retroTemplate() {
    const result = await read(
      db.execute(sql`
        SELECT id::text AS id, content FROM templates
        WHERE kind = 'doc' AND subtype = 'retro' AND built_in
        LIMIT 1
      `),
    );
    const [row] = rowsOf(result, z.object({ id: z.string(), content: richTextDocSchema }));
    return row ?? null;
  }

  /** The "Retros" page and the positions after the last top-level page and its last child. */
  async function placement(sprintId: string) {
    const project = sql`(SELECT project_id FROM sprints WHERE id = ${sprintId}::uuid)`;
    const parent = sql`(
      SELECT id FROM docs
      WHERE project_id = ${project} AND parent_id IS NULL AND title = ${RETROS_PAGE_TITLE}
        AND deleted_at IS NULL
      ORDER BY position COLLATE "C", id
      LIMIT 1
    )`;
    const result = await read(
      db.execute(sql`
        SELECT ${parent}::text AS parent_id,
          (SELECT max(position COLLATE "C") FROM docs
            WHERE project_id = ${project} AND parent_id IS NULL AND deleted_at IS NULL)
            AS root_last,
          (SELECT max(position COLLATE "C") FROM docs
            WHERE parent_id = ${parent} AND deleted_at IS NULL) AS child_last
      `),
    );
    const [row] = rowsOf(result, placeRow);
    return row ?? { parent_id: null, root_last: null, child_last: null };
  }

  async function projectKeys() {
    const result = await read(db.execute(sql`SELECT key FROM projects`));
    return rowsOf(result, z.object({ key: z.string() })).map((row) => row.key);
  }

  return {
    /**
     * Makes the sprint's retro doc unless it has a live one (then returns that one).
     * `onlyIfEnabled`: do nothing (null) unless the project's `auto_retro` is on, for the
     * call right after a completion.
     */
    async ensureRetro(
      actorId: string,
      sprintId: string,
      { onlyIfEnabled = false }: { onlyIfEnabled?: boolean } = {},
    ): Promise<EnsuredRetro | null> {
      // One round trip for everything the doc needs.
      const [sprint, completed, carried, template, place, keys] = await Promise.all([
        sprintOf(sprintId),
        completedIssues(sprintId),
        carriedIssues(sprintId),
        retroTemplate(),
        placement(sprintId),
        projectKeys(),
      ]);
      if (onlyIfEnabled && !sprint.auto_retro) return null;
      if (sprint.retro_doc_id) return { docId: sprint.retro_doc_id, created: false };
      if (sprint.state !== "closed") {
        throw invalid("A retro is made when the sprint is completed");
      }

      const toIssue = (row: z.infer<typeof issueRow>) => ({
        key: formatIssueKey(sprint.project_key, row.number),
        title: row.title,
        points: row.points,
      });
      const content: RichTextDoc = buildRetroDoc({
        sprint: {
          name: sprint.name,
          goal: sprint.goal,
          startDate: sprint.start_date,
          endDate: sprint.end_date,
        },
        completed: completed.map(toIssue),
        carried: carried.map(toIssue),
        template: template?.content ?? null,
      });
      const docId = crypto.randomUUID();
      const parentId = crypto.randomUUID();
      const emptyPage: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };
      const rootPosition = generateKeyBetween(place.root_last, null);
      // A page found now is used below; a page made by the write starts with this one child.
      // Read before the lock: a concurrent create may pick the same key, which only ties the
      // order (positions are not unique; ties sort by id), so it is accepted.
      const childPosition = generateKeyBetween(place.parent_id ? place.child_last : null, null);
      const gate = sql`EXISTS (SELECT 1 FROM inserted)`;

      const results = await options.runAtomic([
        // The docs-tree lock (as `docs.ts` takes it) orders this against tree moves,
        // deletes and other retros, so two of them never both create "Retros".
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hq.docs_tree:${sprint.project_id}`}, 0))`,
        // Serialises retros of this sprint; the next statement sees the committed state.
        sql`SELECT id FROM sprints WHERE id = ${sprintId}::uuid FOR UPDATE`,
        sql`
          WITH s AS (
            SELECT id, project_id FROM sprints
            WHERE id = ${sprintId}::uuid AND state = 'closed'
              AND NOT EXISTS (SELECT 1 FROM docs d
                WHERE d.id = sprints.retro_doc_id AND d.deleted_at IS NULL)
          ),
          existing_parent AS (
            SELECT d.id FROM docs d, s
            WHERE d.project_id = s.project_id AND d.parent_id IS NULL
              AND d.title = ${RETROS_PAGE_TITLE} AND d.deleted_at IS NULL
            ORDER BY d.position COLLATE "C", d.id
            LIMIT 1
          ),
          new_parent AS (
            INSERT INTO docs (id, project_id, type, title, content, content_text, owner_id,
              updated_by, position)
            SELECT ${parentId}::uuid, s.project_id, 'page', ${RETROS_PAGE_TITLE},
              ${jsonbOrNull(emptyPage)}, '', ${actorId}::uuid, ${actorId}::uuid,
              ${rootPosition}
            FROM s WHERE NOT EXISTS (SELECT 1 FROM existing_parent)
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
            SELECT id FROM existing_parent UNION ALL SELECT id FROM new_parent
          ),
          inserted AS (
            INSERT INTO docs (id, project_id, parent_id, type, title, content, content_text,
              owner_id, updated_by, position, template_id)
            SELECT ${docId}::uuid, s.project_id, (SELECT id FROM parent LIMIT 1), 'retro',
              ${retroTitle(sprint.name)}, ${jsonbOrNull(content)}, ${extractPlainText(content)},
              ${actorId}::uuid, ${actorId}::uuid, ${childPosition},
              ${template?.id ?? null}::uuid
            FROM s
            RETURNING id, version, title, content
          ),
          first_version AS (
            INSERT INTO doc_versions (doc_id, version, title, content, author_id)
            SELECT id, version, title, content, ${actorId}::uuid FROM inserted
          ),
          created_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value, meta)
            SELECT 'doc', id, ${actorId}::uuid, 'created', 'retro',
              jsonb_build_object('sprintId', ${sprintId}::text)
            FROM inserted
          ),
          ${mentionSyncCtes({
            // Safe inline: the doc is new, so no other request can be syncing it.
            fromType: "doc",
            fromId: docId,
            refs: docRefs(content, keys),
            actorId,
            gate,
          })},
          linked AS (
            UPDATE sprints SET retro_doc_id = inserted.id, updated_at = now()
            FROM inserted WHERE sprints.id = ${sprintId}::uuid
            RETURNING sprints.id
          ),
          sprint_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
            SELECT 'sprint', ${sprintId}::uuid, ${actorId}::uuid, ${RETRO_CREATED_ACTION},
              jsonb_build_object('docId', inserted.id::text)
            FROM inserted
          )
          SELECT id::text AS doc_id FROM inserted
        `,
      ]);
      const [row] = rowsOf(results.at(-1), z.object({ doc_id: z.string() }));
      if (row) return { docId: row.doc_id, created: true };
      // Someone else made it meanwhile (or the sprint changed): report what is there now.
      const now = await sprintOf(sprintId);
      if (now.retro_doc_id) return { docId: now.retro_doc_id, created: false };
      if (now.state !== "closed") throw invalid("A retro is made when the sprint is completed");
      throw conflict("Could not create the retro; try again");
    },
  };
}

export type SprintRetroService = ReturnType<typeof createSprintRetroService>;
