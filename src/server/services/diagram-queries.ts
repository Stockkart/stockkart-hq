import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { emptyScene, parseScene } from "@/lib/diagrams/scene";
import {
  type DiagramCard,
  type DiagramDetail,
  type DiagramLinkView,
  type DiagramOption,
  type DiagramTemplateView,
  type DiagramVersionScene,
  type DiagramVersionView,
} from "@/lib/diagrams/views";
import { docPath } from "@/lib/docs/views";
import { formatIssueKey, issuePath } from "@/lib/issues/keys";
import { diagramKindOfTemplate } from "@/lib/templates/diagram-templates";
import { diagrams, diagramVersions, projects, users } from "@/server/db/schema";
import { directRead } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";
import { type IdRef, rowsOf } from "./sql";

/** Picker and list limits. */
const PICKER_LIMIT = 20;

/** `%`, `_` and `\` are literal in a title search. */
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Read side of the diagram pages (DGM-*). Every query skips soft-deleted diagrams and takes
 * ids or `IdRef` subqueries, so a page starts all of them together: ONE round trip on Neon.
 */
export function createDiagramQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  return {
    /**
     * §5.6 list grid in list order. With `query`, only diagrams whose title or labels match
     * (the generated `search` column, `websearch_to_tsquery` like ⌘K).
     */
    async listDiagrams(projectId: IdRef, query = ""): Promise<DiagramCard[]> {
      const owner = pgAlias(users, "owner");
      const q = query.trim();
      const matches = q
        ? sql`${diagrams.search} @@ websearch_to_tsquery('english', ${q})
            AND querytree(websearch_to_tsquery('english', ${q})) <> 'T'`
        : sql`TRUE`;
      return read(
        db
          .select({
            id: diagrams.id,
            kind: diagrams.kind,
            title: diagrams.title,
            position: diagrams.position,
            ownerName: owner.name,
            updatedAt: diagrams.updatedAt,
            hasThumbnail: sql<boolean>`${diagrams.thumbnailKey} IS NOT NULL`,
          })
          .from(diagrams)
          .leftJoin(owner, eq(owner.id, diagrams.ownerId))
          .where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt), matches))
          .orderBy(asc(diagrams.position), asc(diagrams.id)),
      );
    },

    async getDiagram(projectId: IdRef, diagramId: string): Promise<DiagramDetail | null> {
      const owner = pgAlias(users, "owner");
      const editor = pgAlias(users, "editor");
      const [row] = await read(
        db
          .select({
            id: diagrams.id,
            projectKey: projects.key,
            kind: diagrams.kind,
            title: diagrams.title,
            scene: diagrams.scene,
            version: diagrams.version,
            ownerName: owner.name,
            updatedByName: editor.name,
            createdAt: diagrams.createdAt,
            updatedAt: diagrams.updatedAt,
            hasThumbnail: sql<boolean>`${diagrams.thumbnailKey} IS NOT NULL`,
          })
          .from(diagrams)
          .innerJoin(projects, eq(projects.id, diagrams.projectId))
          .leftJoin(owner, eq(owner.id, diagrams.ownerId))
          .leftJoin(editor, eq(editor.id, diagrams.updatedBy))
          .where(
            and(
              eq(diagrams.id, diagramId),
              eq(diagrams.projectId, projectId),
              isNull(diagrams.deletedAt),
            ),
          )
          .limit(1),
      );
      if (!row) return null;
      const scene = parseScene(row.kind, row.scene);
      // A stored scene always passed this check on save; an empty one is the safe fallback.
      return { ...row, scene: scene.ok ? scene.scene : emptyScene(row.kind) };
    },

    /** DGM-4 history, newest first (at most the 50 kept, §7.3). */
    async listVersions(diagramId: string): Promise<DiagramVersionView[]> {
      return read(
        db
          .select({
            version: diagramVersions.version,
            title: diagramVersions.title,
            authorName: users.name,
            createdAt: diagramVersions.createdAt,
          })
          .from(diagramVersions)
          .innerJoin(
            diagrams,
            and(eq(diagrams.id, diagramVersions.diagramId), isNull(diagrams.deletedAt)),
          )
          .leftJoin(users, eq(users.id, diagramVersions.authorId))
          .where(eq(diagramVersions.diagramId, diagramId))
          .orderBy(desc(diagramVersions.version))
          .limit(50),
      );
    },

    /** One version's scene, for the read-only preview. */
    async getVersion(diagramId: string, version: number): Promise<DiagramVersionScene | null> {
      const [row] = await read(
        db
          .select({
            kind: diagrams.kind,
            version: diagramVersions.version,
            title: diagramVersions.title,
            scene: diagramVersions.scene,
            authorName: users.name,
            createdAt: diagramVersions.createdAt,
          })
          .from(diagramVersions)
          .innerJoin(
            diagrams,
            and(eq(diagrams.id, diagramVersions.diagramId), isNull(diagrams.deletedAt)),
          )
          .leftJoin(users, eq(users.id, diagramVersions.authorId))
          .where(
            and(eq(diagramVersions.diagramId, diagramId), eq(diagramVersions.version, version)),
          )
          .limit(1),
      );
      if (!row) return null;
      const scene = parseScene(row.kind, row.scene);
      return { ...row, scene: scene.ok ? scene.scene : emptyScene(row.kind) };
    },

    /**
     * "Linked" panel: manual links from the diagram (issues, docs), links others store to it,
     * and docs that embed it (DOC-8 `diagramEmbed` nodes, found in the doc JSON at read
     * time, so no doc save has to keep a link in sync). One statement.
     */
    async links(diagramId: string): Promise<DiagramLinkView[]> {
      const embedPath = '$.** ? (@.type == "diagramEmbed" && @.attrs.diagramId == $id)';
      const result = await read(
        db.execute(sql`
          WITH me AS (SELECT ${diagramId}::uuid AS id),
          outgoing AS (
            SELECT l.id AS link_id, l.to_type::text AS kind, 'manual' AS source, l.to_id
            FROM entity_links l, me
            WHERE l.from_type = 'diagram' AND l.from_id = me.id AND l.to_type IN ('issue', 'doc')
          ),
          incoming AS (
            SELECT NULL::uuid AS link_id, l.from_type::text AS kind, 'incoming' AS source,
              l.from_id AS to_id
            FROM entity_links l, me
            WHERE l.to_type = 'diagram' AND l.to_id = me.id AND l.from_type IN ('issue', 'doc')
          ),
          embeds AS (
            SELECT NULL::uuid AS link_id, 'doc' AS kind, 'embed' AS source, d.id AS to_id
            FROM docs d, me
            WHERE d.deleted_at IS NULL AND d.content IS NOT NULL
              AND jsonb_path_exists(d.content, ${embedPath}::jsonpath,
                jsonb_build_object('id', me.id::text))
          ),
          all_links AS (
            SELECT * FROM outgoing UNION ALL SELECT * FROM incoming UNION ALL SELECT * FROM embeds
          )
          SELECT a.link_id::text, a.kind, a.source, a.to_id::text AS target_id,
            i.number AS issue_number, i.title AS issue_title, ip.key AS issue_project_key,
            d.title AS doc_title, dp.key AS doc_project_key
          FROM all_links a
          LEFT JOIN issues i ON a.kind = 'issue' AND i.id = a.to_id AND i.deleted_at IS NULL
          LEFT JOIN projects ip ON ip.id = i.project_id
          LEFT JOIN docs d ON a.kind = 'doc' AND d.id = a.to_id AND d.deleted_at IS NULL
          LEFT JOIN projects dp ON dp.id = d.project_id
          ORDER BY a.source, coalesce(d.title, i.title)
        `),
      );
      const rows = rowsOf(
        result,
        z.object({
          link_id: z.string().nullable(),
          kind: z.enum(["issue", "doc"]),
          source: z.enum(["manual", "embed", "incoming"]),
          target_id: z.string(),
          issue_number: z.number().nullable(),
          issue_title: z.string().nullable(),
          issue_project_key: z.string().nullable(),
          doc_title: z.string().nullable(),
          doc_project_key: z.string().nullable(),
        }),
      );
      const seen = new Set<string>();
      return rows.flatMap((row): DiagramLinkView[] => {
        let entry: Omit<DiagramLinkView, "key"> | null = null;
        if (row.kind === "issue" && row.issue_number !== null && row.issue_project_key) {
          entry = {
            linkId: row.link_id,
            kind: "issue",
            source: row.source,
            label:
              `${formatIssueKey(row.issue_project_key, row.issue_number)} ${row.issue_title ?? ""}`.trim(),
            href: issuePath(row.issue_project_key, row.issue_number),
          };
        } else if (row.kind === "doc" && row.doc_project_key && row.doc_title !== null) {
          entry = {
            linkId: row.link_id,
            kind: "doc",
            source: row.source,
            label: row.doc_title,
            href: docPath(row.doc_project_key, row.target_id),
          };
        }
        if (!entry) return []; // the other side was deleted
        const key = `${row.source}:${row.kind}:${row.target_id}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ key, ...entry }];
      });
    },

    /** DGM-3 picker: the diagram templates (built-in and custom). */
    async diagramTemplates(): Promise<DiagramTemplateView[]> {
      const result = await read(
        db.execute(sql`
          SELECT id::text, subtype, name, description FROM templates
          WHERE kind = 'diagram' ORDER BY built_in DESC, name
        `),
      );
      const rows = rowsOf(
        result,
        z.object({
          id: z.string(),
          subtype: z.string(),
          name: z.string(),
          description: z.string().nullable(),
        }),
      );
      return rows.flatMap((row) => {
        const kind = diagramKindOfTemplate(row.subtype);
        return kind ? [{ id: row.id, kind, name: row.name, description: row.description }] : [];
      });
    },

    /** DOC-8 "Insert diagram" picker: by title (or the most recent ones). */
    async diagramOptions(projectKey: string, query: string): Promise<DiagramOption[]> {
      const q = query.trim();
      return read(
        db
          .select({
            id: diagrams.id,
            title: diagrams.title,
            kind: diagrams.kind,
            projectKey: projects.key,
          })
          .from(diagrams)
          .innerJoin(projects, eq(projects.id, diagrams.projectId))
          .where(
            and(
              eq(projects.key, projectKey),
              isNull(diagrams.deletedAt),
              q ? sql`${diagrams.title} ILIKE ${likePattern(q)}` : sql`TRUE`,
            ),
          )
          .orderBy(desc(diagrams.updatedAt))
          .limit(PICKER_LIMIT),
      );
    },

    /** "Linked" → doc picker: live docs of the project by title. */
    async docOptions(projectKey: string, query: string): Promise<{ id: string; title: string }[]> {
      const q = query.trim();
      const result = await read(
        db.execute(sql`
          SELECT d.id::text, d.title FROM docs d JOIN projects p ON p.id = d.project_id
          WHERE p.key = ${projectKey} AND d.deleted_at IS NULL
            AND (${q} = '' OR d.title ILIKE ${likePattern(q)})
          ORDER BY d.updated_at DESC
          LIMIT ${PICKER_LIMIT}
        `),
      );
      return rowsOf(result, z.object({ id: z.string(), title: z.string() }));
    },
  };
}

export type DiagramQueries = ReturnType<typeof createDiagramQueries>;
