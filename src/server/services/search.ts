import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { DIAGRAM_KIND_LABELS, DIAGRAM_KINDS } from "@/lib/diagrams/constants";
import { diagramPath } from "@/lib/diagrams/links";
import { docPath } from "@/lib/docs/views";
import { formatIssueKey, issuePath, parseIssueKey } from "@/lib/issues/keys";
import {
  EMPTY_RESULTS,
  SEARCH_GROUP_LIMIT,
  type SearchHit,
  type SearchResults,
} from "@/lib/search/schemas";
import { HIGHLIGHT_END, HIGHLIGHT_START, parseHighlighted } from "@/lib/search/snippet";
import { issues, projects } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { rowsOf } from "./sql";

/**
 * SRCH-1/2 global search over issues, docs, diagrams and comments with Postgres full-text search
 * (`websearch_to_tsquery`, so "quoted phrases", `or` and `-word` work), ranked with
 * `ts_rank` over the GIN-indexed generated `search` columns. Soft-deleted rows, and comments
 * on deleted issues or docs, never appear.
 *
 * Snippets come from `ts_headline` with control-character markers (stripped from the source
 * text first, so stored text cannot fake a highlight) and are returned as text plus ranges
 * (`parseHighlighted`), never as HTML.
 */

const HEADLINE_OPTIONS = [
  `StartSel=${HIGHLIGHT_START}`,
  `StopSel=${HIGHLIGHT_END}`,
  "MaxWords=30",
  "MinWords=10",
  "MaxFragments=2",
  'FragmentDelimiter=" … "',
].join(", ");

/**
 * `ts_headline` of `column`, with any marker characters removed from the input first.
 * `column` is always one of the literal column names in this file, never user input.
 */
const headline = (column: string) => sql`ts_headline('english',
  translate(${sql.raw(column)}, ${HIGHLIGHT_START + HIGHLIGHT_END}, ''),
  q.query, ${HEADLINE_OPTIONS})`;

const snippetOf = (value: string | null) => (value ? parseHighlighted(value) : null);

/**
 * A query of only negations (`-foo`) matches nearly every row and cannot use the GIN index,
 * so it would scan whole tables per keystroke; `querytree` is `T` for such queries.
 */
const indexable = sql`querytree(q.query) <> 'T'`;

const adrTitle = (adrNumber: number | null, title: string) =>
  adrNumber === null ? title : `ADR-${String(adrNumber).padStart(4, "0")} ${title}`;

export function createSearchService(db: AppDatabase) {
  async function jumpTo(query: string): Promise<SearchResults["jump"]> {
    const ref = parseIssueKey(query);
    if (!ref) return null;
    const [row] = await db
      .select({ title: issues.title })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(
        and(
          eq(projects.key, ref.projectKey),
          eq(issues.number, ref.number),
          isNull(issues.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      key: formatIssueKey(ref.projectKey, ref.number),
      title: row.title,
      href: issuePath(ref.projectKey, ref.number),
    };
  }

  async function searchIssues(query: string): Promise<SearchHit[]> {
    const result = await db.execute(sql`
      WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
      SELECT i.id::text AS id, i.number, i.title, p.key AS project_key,
        CASE WHEN i.description_text <> '' THEN ${headline("i.description_text")} END AS snippet
      FROM q, issues i JOIN projects p ON p.id = i.project_id
      WHERE i.deleted_at IS NULL AND i.search @@ q.query AND ${indexable}
      ORDER BY ts_rank(i.search, q.query) DESC, i.number DESC
      LIMIT ${SEARCH_GROUP_LIMIT}
    `);
    const rows = rowsOf(
      result,
      z.object({
        id: z.string(),
        number: z.number(),
        title: z.string(),
        project_key: z.string(),
        snippet: z.string().nullable(),
      }),
    );
    return rows.map((row) => ({
      kind: "issue",
      id: row.id,
      href: issuePath(row.project_key, row.number),
      title: `${formatIssueKey(row.project_key, row.number)} ${row.title}`,
      context: null,
      snippet: snippetOf(row.snippet),
    }));
  }

  async function searchDocs(query: string): Promise<SearchHit[]> {
    const result = await db.execute(sql`
      WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
      SELECT d.id::text AS id, d.title, d.adr_number, p.key AS project_key,
        CASE WHEN d.content_text <> '' THEN ${headline("d.content_text")} END AS snippet
      FROM q, docs d JOIN projects p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL AND d.search @@ q.query AND ${indexable}
      ORDER BY ts_rank(d.search, q.query) DESC, d.updated_at DESC
      LIMIT ${SEARCH_GROUP_LIMIT}
    `);
    const rows = rowsOf(
      result,
      z.object({
        id: z.string(),
        title: z.string(),
        adr_number: z.number().nullable(),
        project_key: z.string(),
        snippet: z.string().nullable(),
      }),
    );
    return rows.map((row) => ({
      kind: "doc",
      id: row.id,
      // The slice 3 doc route (`[projectKey]/docs/[id]`); ADRs open there too.
      href: docPath(row.project_key, row.id),
      title: adrTitle(row.adr_number, row.title),
      context: null,
      snippet: snippetOf(row.snippet),
    }));
  }

  /** Diagrams by title and labels (`scene_text`); the kind is the hit's context (§5.7). */
  async function searchDiagrams(query: string): Promise<SearchHit[]> {
    const result = await db.execute(sql`
      WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
      SELECT g.id::text AS id, g.title, g.kind::text AS kind, p.key AS project_key,
        CASE WHEN g.scene_text <> '' THEN ${headline("left(g.scene_text, 20000)")} END AS snippet
      FROM q, diagrams g JOIN projects p ON p.id = g.project_id
      WHERE g.deleted_at IS NULL AND g.search @@ q.query AND ${indexable}
      ORDER BY ts_rank(g.search, q.query) DESC, g.updated_at DESC
      LIMIT ${SEARCH_GROUP_LIMIT}
    `);
    const rows = rowsOf(
      result,
      z.object({
        id: z.string(),
        title: z.string(),
        kind: z.enum(DIAGRAM_KINDS),
        project_key: z.string(),
        snippet: z.string().nullable(),
      }),
    );
    return rows.map((row) => ({
      kind: "diagram",
      id: row.id,
      href: diagramPath(row.project_key, row.id),
      title: row.title,
      context: DIAGRAM_KIND_LABELS[row.kind],
      snippet: snippetOf(row.snippet),
    }));
  }

  async function searchComments(query: string): Promise<SearchHit[]> {
    // A comment is shown only while the issue or doc it belongs to is live too.
    const result = await db.execute(sql`
      WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
      SELECT c.id::text AS id, ${headline("c.body_text")} AS snippet,
        i.number AS issue_number, i.title AS issue_title, ip.key AS issue_project_key,
        d.id::text AS doc_id, d.title AS doc_title, d.adr_number, dp.key AS doc_project_key
      FROM q, comments c
      LEFT JOIN issues i
        ON c.entity_type = 'issue' AND i.id = c.entity_id AND i.deleted_at IS NULL
      LEFT JOIN projects ip ON ip.id = i.project_id
      LEFT JOIN docs d ON c.entity_type = 'doc' AND d.id = c.entity_id AND d.deleted_at IS NULL
      LEFT JOIN projects dp ON dp.id = d.project_id
      WHERE c.deleted_at IS NULL AND c.search @@ q.query AND ${indexable}
        AND (i.id IS NOT NULL OR d.id IS NOT NULL)
      ORDER BY ts_rank(c.search, q.query) DESC, c.created_at DESC
      LIMIT ${SEARCH_GROUP_LIMIT}
    `);
    const rows = rowsOf(
      result,
      z.object({
        id: z.string(),
        snippet: z.string().nullable(),
        issue_number: z.number().nullable(),
        issue_title: z.string().nullable(),
        issue_project_key: z.string().nullable(),
        doc_id: z.string().nullable(),
        doc_title: z.string().nullable(),
        adr_number: z.number().nullable(),
        doc_project_key: z.string().nullable(),
      }),
    );
    return rows.flatMap((row): SearchHit[] => {
      if (row.issue_number !== null && row.issue_project_key && row.issue_title !== null) {
        const key = formatIssueKey(row.issue_project_key, row.issue_number);
        return [
          {
            kind: "comment",
            id: row.id,
            href: issuePath(row.issue_project_key, row.issue_number),
            title: `Comment on ${key} ${row.issue_title}`,
            context: key,
            snippet: snippetOf(row.snippet),
          },
        ];
      }
      if (row.doc_id && row.doc_project_key && row.doc_title !== null) {
        const title = adrTitle(row.adr_number, row.doc_title);
        return [
          {
            kind: "comment",
            id: row.id,
            href: docPath(row.doc_project_key, row.doc_id),
            title: `Comment on ${title}`,
            context: title,
            snippet: snippetOf(row.snippet),
          },
        ];
      }
      return [];
    });
  }

  return {
    /** `query` is already trimmed and length-checked by `searchInput`. */
    async search(query: string): Promise<SearchResults> {
      if (!query) return EMPTY_RESULTS;
      const [jump, issueHits, docHits, diagramHits, commentHits] = await Promise.all([
        jumpTo(query),
        searchIssues(query),
        searchDocs(query),
        searchDiagrams(query),
        searchComments(query),
      ]);
      return {
        jump,
        issues: issueHits,
        docs: docHits,
        diagrams: diagramHits,
        comments: commentHits,
      };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
