import { type SQL, sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";

import { type EntityType } from "@/lib/issues/constants";
import { extractIssueRefs, type IssueRef } from "@/lib/issues/keys";
import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";

/**
 * Helpers for the raw, single-statement writes (see `AppDatabase` for why writes are single
 * statements). Raw results are untyped, so rows are always parsed with Zod.
 */

export function rowsOf<T extends z.ZodType>(result: unknown, row: T): z.infer<T>[] {
  return z.object({ rows: z.array(row) }).parse(result).rows;
}

/** A nullable uuid parameter. */
export const uuidOrNull = (value: string | null | undefined) => sql`${value ?? null}::uuid`;

/**
 * An id, or a scalar subquery that yields it. Read queries accept either, so a page can
 * send "the project with key STK" and the queries that need its id in ONE batch, instead
 * of first looking the project up and then running the rest (one more round trip).
 */
export type IdRef = string | SQL;

/** The id of the live (unarchived) project with this key; NULL when there is none. */
export const projectIdByKey = (key: string): SQL =>
  sql`(SELECT id FROM projects WHERE key = ${key} AND archived_at IS NULL)`;

/** The id of the live issue with this number in that project; NULL when there is none. */
export const issueIdByNumber = (projectId: IdRef, number: number): SQL =>
  sql`(SELECT id FROM issues WHERE project_id = ${projectId}::uuid AND number = ${number}
    AND deleted_at IS NULL)`;

const labelRow = z.object({ id: z.string(), name: z.string(), color: z.string().nullable() });

/**
 * An issue's labels as one json column (by name), so a list loads its labels in the same
 * statement instead of a second query keyed by the first one's ids.
 */
export const labelsJson = (issueId: SQL | SQLWrapper): SQL =>
  sql`COALESCE((
    SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color)
      ORDER BY l.name)
    FROM issue_labels il JOIN labels l ON l.id = il.label_id
    WHERE il.issue_id = ${issueId}
  ), '[]'::json)`;

/** Parses a `labelsJson` column. */
export const parseLabels = (value: unknown): z.infer<typeof labelRow>[] =>
  z.array(labelRow).parse(value);

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
 * same key would conflict. `gate` is a boolean SQL expression so nothing changes when the
 * entity is gone (or the actor may not edit it).
 *
 * Inline these CTEs only into the statement that CREATES the entity (nobody else can be
 * syncing it yet). For an edit use `mentionSyncStatement` as the second statement of a
 * `RunAtomic` transaction: a concurrent edit's links committed while this one waited for
 * the row lock are invisible to the first statement's snapshot, but not to the second's.
 */
export function mentionSyncCtes(input: {
  fromType: EntityType;
  fromId: string;
  refs: readonly IssueRef[];
  /** Null for system writes such as the handbook import (IMP-1). */
  actorId: string | null;
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

/** `mentionSyncCtes` as a statement of its own (see there for when to use which). */
export function mentionSyncStatement(input: Parameters<typeof mentionSyncCtes>[0]): SQL {
  return sql`WITH ${mentionSyncCtes(input)} SELECT 1 AS synced`;
}

/** Issue references in a document's text, ignoring code (ISS-7). */
export function docRefs(doc: RichTextDoc | null, projectKeys: readonly string[]): IssueRef[] {
  return doc ? extractIssueRefs(extractPlainText(doc, { skipCode: true }), projectKeys) : [];
}
