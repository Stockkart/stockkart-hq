import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type IssueRef } from "@/lib/issues/keys";
import { type EntityType } from "@/lib/issues/constants";

/**
 * Helpers for the raw, single-statement writes (see `AppDatabase` for why writes are single
 * statements). Raw results are untyped, so rows are always parsed with Zod.
 */

export function rowsOf<T extends z.ZodType>(result: unknown, row: T): z.infer<T>[] {
  return z.object({ rows: z.array(row) }).parse(result).rows;
}

/** A nullable uuid parameter. */
export const uuidOrNull = (value: string | null | undefined) => sql`${value ?? null}::uuid`;

/** A jsonb parameter (or SQL NULL). */
export const jsonbOrNull = (value: unknown) =>
  value === null || value === undefined ? sql`NULL::jsonb` : sql`${JSON.stringify(value)}::jsonb`;

/**
 * CTEs that make the `mention` entity links from one entity (an issue description or a
 * comment) match the issue references currently in its text (ISS-7, DOC-9):
 *
 *   mention_targets  the referenced issues that exist (and are not the entity itself)
 *   mention_removed  links to issues no longer mentioned
 *   mention_added    links to newly mentioned issues (existing ones are left alone)
 *
 * Deleting only the stale links (instead of delete-all-then-insert) keeps the statement
 * correct: all CTEs in one statement see the same snapshot, so a delete and an insert of the
 * same key would conflict. `gate` is a boolean SQL expression (usually `EXISTS (SELECT 1
 * FROM <write cte>)`) so nothing changes when the main write matched no row.
 */
export function mentionSyncCtes(input: {
  fromType: EntityType;
  fromId: string;
  refs: readonly IssueRef[];
  actorId: string;
  gate: SQL;
}): SQL {
  const refs = JSON.stringify(input.refs.map((ref) => ({ key: ref.projectKey, num: ref.number })));
  return sql`
    mention_targets AS (
      SELECT DISTINCT i.id
      FROM jsonb_to_recordset(${refs}::jsonb) AS r(key text, num int)
      JOIN projects p ON p.key = r.key
      JOIN issues i ON i.project_id = p.id AND i.number = r.num AND i.deleted_at IS NULL
      WHERE i.id <> ${input.fromId}::uuid
    ),
    mention_removed AS (
      DELETE FROM entity_links
      WHERE from_type = ${input.fromType}::entity_type AND from_id = ${input.fromId}::uuid
        AND to_type = 'issue' AND origin = 'mention'
        AND to_id NOT IN (SELECT id FROM mention_targets)
        AND ${input.gate}
    ),
    mention_added AS (
      INSERT INTO entity_links (from_type, from_id, to_type, to_id, origin, created_by)
      SELECT ${input.fromType}::entity_type, ${input.fromId}::uuid, 'issue', id, 'mention',
        ${input.actorId}::uuid
      FROM mention_targets
      WHERE ${input.gate}
      ON CONFLICT DO NOTHING
    )`;
}
