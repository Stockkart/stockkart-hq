import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { ISSUE_TYPES } from "@/lib/issues/constants";
import { formatIssueKey } from "@/lib/issues/keys";
import {
  type restoreInput,
  type RestoreResult,
  TRASH_DAYS,
  type TrashedDoc,
  type TrashedIssue,
} from "@/lib/trash/views";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { notFound } from "./errors";
import { type IdRef, rowsOf } from "./sql";

/** Most rows the trash lists per kind (newest first). */
export const TRASH_LIST_LIMIT = 500;

/** Deleted within the last `TRASH_DAYS` days. */
const recent = (column: SQL) => sql`${column} >= now() - make_interval(days => ${TRASH_DAYS})`;

/**
 * ISS-13 trash. Lists and restores soft-deleted issues and docs of the last `TRASH_DAYS`
 * days. Older ones are hidden here and can no longer be restored, but nothing is purged
 * (§9.3: a purge job is P2).
 *
 * A restored issue whose parent is still deleted comes back without a parent (with an
 * activity row saying why), so it never hangs under an issue nobody can see; a restored doc
 * whose parent page is deleted comes back at the top level. Both are one transaction.
 */
export function createTrashService(
  db: AppDatabase,
  options: { runAtomic: RunAtomic; read?: Read },
) {
  const read = options.read ?? directRead;
  const projectOf = (key: string) =>
    sql`(SELECT id FROM projects WHERE key = ${key} AND archived_at IS NULL)`;

  /**
   * One statement: row-locks the trashed issue, clears `deleted_at`, drops a deleted
   * parent, and records `restored` (plus the parent change, with its reason).
   */
  async function restoreIssue(
    actorId: string,
    projectKey: string,
    issueId: string,
  ): Promise<RestoreResult> {
    const result = await db.execute(sql`
        WITH target AS (
          SELECT i.id, i.parent_id FROM issues i
          WHERE i.id = ${issueId}::uuid AND i.project_id = ${projectOf(projectKey)}
            AND i.deleted_at IS NOT NULL AND ${recent(sql`i.deleted_at`)}
          FOR UPDATE
        ),
        -- Share-locks the parent, so a delete (or restore) of it running now is ordered
        -- against this restore and its outcome is the one seen here.
        parent AS (
          SELECT p.id, p.deleted_at FROM issues p JOIN target t ON p.id = t.parent_id
          FOR SHARE OF p
        ),
        parent_gone AS (
          SELECT 1 FROM target t
          WHERE t.parent_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM parent WHERE parent.deleted_at IS NULL)
        ),
        restored AS (
          UPDATE issues SET deleted_at = NULL,
            parent_id = CASE WHEN EXISTS (SELECT 1 FROM parent_gone) THEN NULL
              ELSE issues.parent_id END,
            updated_at = now()
          FROM target WHERE issues.id = target.id
          RETURNING issues.id, issues.number, target.parent_id AS old_parent,
            issues.parent_id AS new_parent
        ),
        restore_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action)
          SELECT 'issue', id, ${actorId}::uuid, 'restored' FROM restored
        ),
        parent_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value, meta)
          SELECT 'issue', id, ${actorId}::uuid, 'updated', 'parent', old_parent::text, NULL,
            jsonb_build_object('reason', 'parent_deleted')
          FROM restored WHERE old_parent IS DISTINCT FROM new_parent
        )
        SELECT number, old_parent IS DISTINCT FROM new_parent AS detached FROM restored
      `);
    const [row] = rowsOf(result, z.object({ number: z.number(), detached: z.boolean() }));
    if (!row) throw notFound("Issue in the trash");
    return { detachedFromParent: row.detached, key: formatIssueKey(projectKey, row.number) };
  }

  /**
   * Restores a doc under the docs tree lock (as `deleteDoc` and `moveDoc` take it), at its
   * old position; under its parent if that page is live, else at the top level. Pages
   * that were lifted out of it when it was deleted stay where they are now.
   */
  async function restoreDoc(
    actorId: string,
    projectKey: string,
    docId: string,
  ): Promise<RestoreResult> {
    const results = await options.runAtomic([
      sql`SELECT pg_advisory_xact_lock(hashtextextended('hq.docs_tree:' || ${projectOf(projectKey)}::text, 0))`,
      sql`
          WITH target AS (
            SELECT d.id, d.parent_id FROM docs d
            WHERE d.id = ${docId}::uuid AND d.project_id = ${projectOf(projectKey)}
              AND d.deleted_at IS NOT NULL AND ${recent(sql`d.deleted_at`)}
            FOR UPDATE
          ),
          parent_gone AS (
            SELECT 1 FROM target t LEFT JOIN docs p ON p.id = t.parent_id
            WHERE t.parent_id IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NOT NULL)
          ),
          restored AS (
            UPDATE docs SET deleted_at = NULL, updated_by = ${actorId}::uuid,
              parent_id = CASE WHEN EXISTS (SELECT 1 FROM parent_gone) THEN NULL
                ELSE docs.parent_id END,
              updated_at = now()
            FROM target WHERE docs.id = target.id
            RETURNING docs.id, target.parent_id AS old_parent, docs.parent_id AS new_parent
          ),
          restore_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action)
            SELECT 'doc', id, ${actorId}::uuid, 'restored' FROM restored
          ),
          parent_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value, meta)
            SELECT 'doc', id, ${actorId}::uuid, 'moved', 'parent', old_parent::text, NULL,
              jsonb_build_object('reason', 'parent_deleted')
            FROM restored WHERE old_parent IS DISTINCT FROM new_parent
          )
          SELECT old_parent IS DISTINCT FROM new_parent AS detached FROM restored
        `,
    ]);
    const [row] = rowsOf(results.at(-1), z.object({ detached: z.boolean() }));
    if (!row) throw notFound("Doc in the trash");
    return { detachedFromParent: row.detached, key: null };
  }

  return {
    async listTrash(projectId: IdRef): Promise<{ issues: TrashedIssue[]; docs: TrashedDoc[] }> {
      const [issueResult, docResult] = await Promise.all([
        read(
          db.execute(sql`
            SELECT i.id::text AS id, i.number, i.title, i.type::text AS type, p.key,
              i.deleted_at AS deleted_at,
              (SELECT u.name FROM activity a JOIN users u ON u.id = a.actor_id
                WHERE a.entity_type = 'issue' AND a.entity_id = i.id AND a.action = 'deleted'
                ORDER BY a.created_at DESC LIMIT 1) AS deleted_by,
              (i.parent_id IS NOT NULL AND (parent.id IS NULL OR parent.deleted_at IS NOT NULL))
                AS parent_deleted
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            LEFT JOIN issues parent ON parent.id = i.parent_id
            WHERE i.project_id = ${projectId} AND i.deleted_at IS NOT NULL
              AND ${recent(sql`i.deleted_at`)}
            ORDER BY i.deleted_at DESC, i.number DESC
            LIMIT ${TRASH_LIST_LIMIT}
          `),
        ),
        read(
          db.execute(sql`
            SELECT d.id::text AS id, d.title, d.deleted_at AS deleted_at,
              (SELECT u.name FROM activity a JOIN users u ON u.id = a.actor_id
                WHERE a.entity_type = 'doc' AND a.entity_id = d.id AND a.action = 'deleted'
                ORDER BY a.created_at DESC LIMIT 1) AS deleted_by,
              (d.parent_id IS NOT NULL AND (parent.id IS NULL OR parent.deleted_at IS NOT NULL))
                AS parent_deleted
            FROM docs d
            LEFT JOIN docs parent ON parent.id = d.parent_id
            WHERE d.project_id = ${projectId} AND d.deleted_at IS NOT NULL
              AND ${recent(sql`d.deleted_at`)}
            ORDER BY d.deleted_at DESC, d.id
            LIMIT ${TRASH_LIST_LIMIT}
          `),
        ),
      ]);
      const deletedAt = z.union([z.date(), z.string()]).transform((value) => new Date(value));
      return {
        issues: rowsOf(
          issueResult,
          z.object({
            id: z.string(),
            number: z.number(),
            title: z.string(),
            type: z.enum(ISSUE_TYPES),
            key: z.string(),
            deleted_at: deletedAt,
            deleted_by: z.string().nullable(),
            parent_deleted: z.boolean(),
          }),
        ).map((row) => ({
          kind: "issue",
          id: row.id,
          key: formatIssueKey(row.key, row.number),
          title: row.title,
          type: row.type,
          deletedAt: row.deleted_at,
          deletedBy: row.deleted_by,
          parentDeleted: row.parent_deleted,
        })),
        docs: rowsOf(
          docResult,
          z.object({
            id: z.string(),
            title: z.string(),
            deleted_at: deletedAt,
            deleted_by: z.string().nullable(),
            parent_deleted: z.boolean(),
          }),
        ).map((row) => ({
          kind: "doc",
          id: row.id,
          title: row.title,
          deletedAt: row.deleted_at,
          deletedBy: row.deleted_by,
          parentDeleted: row.parent_deleted,
        })),
      };
    },

    async restore(actorId: string, input: z.output<typeof restoreInput>): Promise<RestoreResult> {
      return input.kind === "issue"
        ? restoreIssue(actorId, input.projectKey, input.id)
        : restoreDoc(actorId, input.projectKey, input.id);
    },

    restoreIssue,
    restoreDoc,
  };
}

export type TrashService = ReturnType<typeof createTrashService>;
