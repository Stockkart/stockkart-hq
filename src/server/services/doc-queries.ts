import { and, asc, desc, eq, exists, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  type AdrRef,
  type AdrRow,
  type DocDetail,
  type DocRef,
  type DocTemplateView,
  type DocTreeItem,
  type DocVersionDetail,
  type DocVersionView,
  type LinkedDocView,
  type LinkedIssueView,
} from "@/lib/docs/views";
import { formatIssueKey } from "@/lib/issues/keys";
import { type UserOption } from "@/lib/issues/views";
import {
  docs,
  docVersions,
  entityLinks,
  handbookPublicationDocs,
  handbookPublications,
  issues,
  projects,
  statuses,
  templates,
  users,
} from "@/server/db/schema";
import { directRead } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import {
  docSyncOf,
  handbookSyncColumns,
  openPublicationDocOn,
  openPublicationOn,
} from "./handbook-queries";
import { type QueryOptions } from "./issue-queries";
import { type IdRef, rowsOf } from "./sql";

/** Read side for the doc pages. Every query skips soft-deleted docs. */
export function createDocQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  return {
    /** DOC-2 tree and list view: every live doc of the project. */
    async listTree(projectId: IdRef): Promise<DocTreeItem[]> {
      const owner = pgAlias(users, "owner");
      const editor = pgAlias(users, "editor");
      return read(
        db
          .select({
            id: docs.id,
            parentId: docs.parentId,
            position: docs.position,
            title: docs.title,
            type: docs.type,
            status: docs.status,
            ownerName: owner.name,
            updatedByName: editor.name,
            updatedAt: docs.updatedAt,
          })
          .from(docs)
          .leftJoin(owner, eq(owner.id, docs.ownerId))
          .leftJoin(editor, eq(editor.id, docs.updatedBy))
          .where(and(eq(docs.projectId, projectId), isNull(docs.deletedAt)))
          .orderBy(asc(docs.position), asc(docs.id)),
      );
    },

    async getDoc(projectId: IdRef, docId: string): Promise<DocDetail | null> {
      const editor = pgAlias(users, "editor");
      const successor = pgAlias(docs, "successor");
      const [row] = await read(
        db
          .select({
            doc: {
              id: docs.id,
              projectId: docs.projectId,
              parentId: docs.parentId,
              title: docs.title,
              type: docs.type,
              status: docs.status,
              content: docs.content,
              version: docs.version,
              ownerId: docs.ownerId,
              createdAt: docs.createdAt,
              updatedAt: docs.updatedAt,
              adrNumber: docs.adrNumber,
              adrStatus: docs.adrStatus,
            },
            projectKey: projects.key,
            updatedByName: editor.name,
            successorId: successor.id,
            successorTitle: successor.title,
            // DOC-14 badge and actions: stored sync state, same query (no extra read).
            ...handbookSyncColumns,
          })
          .from(docs)
          .innerJoin(projects, eq(projects.id, docs.projectId))
          .leftJoin(editor, eq(editor.id, docs.updatedBy))
          .leftJoin(
            successor,
            and(eq(successor.id, docs.adrSupersededBy), isNull(successor.deletedAt)),
          )
          .leftJoin(handbookPublicationDocs, openPublicationDocOn)
          .leftJoin(handbookPublications, openPublicationOn)
          .where(and(eq(docs.id, docId), eq(docs.projectId, projectId), isNull(docs.deletedAt)))
          .limit(1),
      );
      if (!row) return null;
      return {
        ...row.doc,
        projectKey: row.projectKey,
        updatedByName: row.updatedByName,
        adrSupersededBy:
          row.successorId && row.successorTitle !== null
            ? { id: row.successorId, title: row.successorTitle }
            : null,
        handbook: docSyncOf({ ...row, ...row.doc }),
      };
    },

    /** Breadcrumb (§5.5): the doc's live ancestors, root first. */
    async ancestors(docId: string): Promise<DocRef[]> {
      const result = await read(
        db.execute(sql`
        WITH RECURSIVE up AS (
          SELECT d.parent_id AS id, 1 AS depth FROM docs d WHERE d.id = ${docId}::uuid
          UNION ALL
          SELECT d.parent_id, up.depth + 1 FROM docs d JOIN up ON d.id = up.id
          WHERE up.depth < 50
        )
        SELECT d.id::text, d.title FROM up JOIN docs d ON d.id = up.id
        WHERE d.deleted_at IS NULL
        ORDER BY up.depth DESC
      `),
      );
      return rowsOf(result, z.object({ id: z.string(), title: z.string() }));
    },

    /** Read-only history (DOC-10 snapshot part): number, author, time; newest first. */
    async listVersions(docId: string): Promise<DocVersionView[]> {
      return read(
        db
          .select({
            version: docVersions.version,
            authorName: users.name,
            createdAt: docVersions.createdAt,
          })
          .from(docVersions)
          .leftJoin(users, eq(users.id, docVersions.authorId))
          .where(eq(docVersions.docId, docId))
          .orderBy(desc(docVersions.version))
          .limit(50),
      );
    },

    /**
     * DOC-10 diff / preview: one snapshot of a live doc, with its content. Loaded when a
     * version is opened (never with the page: 50 contents would make it heavy).
     */
    async getVersion(docId: string, version: number): Promise<DocVersionDetail | null> {
      const [row] = await read(
        db
          .select({
            version: docVersions.version,
            title: docVersions.title,
            content: docVersions.content,
            authorName: users.name,
            createdAt: docVersions.createdAt,
          })
          .from(docVersions)
          .innerJoin(docs, and(eq(docs.id, docVersions.docId), isNull(docs.deletedAt)))
          .leftJoin(users, eq(users.id, docVersions.authorId))
          .where(and(eq(docVersions.docId, docId), eq(docVersions.version, version)))
          .limit(1),
      );
      return row ?? null;
    },

    /** ADR-3 "Supersedes ADR-0007": live ADRs whose successor is this doc. */
    async supersedes(docId: string): Promise<AdrRef[]> {
      return read(
        db
          .select({ id: docs.id, title: docs.title, adrNumber: docs.adrNumber })
          .from(docs)
          .where(and(eq(docs.adrSupersededBy, docId), eq(docs.type, "adr"), isNull(docs.deletedAt)))
          .orderBy(asc(docs.adrNumber)),
      );
    },

    /** DOC-9 "Linked issues": mentions and manual links stored from this doc. */
    async linkedIssues(docId: string): Promise<LinkedIssueView[]> {
      const rows = await read(
        db
          .select({
            linkId: entityLinks.id,
            origin: entityLinks.origin,
            id: issues.id,
            number: issues.number,
            title: issues.title,
            type: issues.type,
            priority: issues.priority,
            projectKey: projects.key,
            statusId: statuses.id,
            statusName: statuses.name,
            statusCategory: statuses.category,
          })
          .from(entityLinks)
          .innerJoin(issues, eq(issues.id, entityLinks.toId))
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .innerJoin(statuses, eq(statuses.id, issues.statusId))
          .where(
            and(
              eq(entityLinks.fromType, "doc"),
              eq(entityLinks.fromId, docId),
              eq(entityLinks.toType, "issue"),
              isNull(issues.deletedAt),
            ),
          )
          .orderBy(asc(issues.number), asc(entityLinks.origin)),
      );
      return rows.map((row) => ({
        linkId: row.linkId,
        origin: row.origin,
        issue: {
          id: row.id,
          key: formatIssueKey(row.projectKey, row.number),
          title: row.title,
          type: row.type,
          priority: row.priority,
          status: { id: row.statusId, name: row.statusName, category: row.statusCategory },
        },
      }));
    },

    /** Docs that link to an issue (its Links panel, DOC-9 / Phase 1 acceptance 7). */
    async docsLinkingTo(issueId: IdRef): Promise<LinkedDocView[]> {
      const rows = await read(
        db
          .selectDistinct({
            id: docs.id,
            title: docs.title,
            type: docs.type,
            origin: entityLinks.origin,
          })
          .from(entityLinks)
          .innerJoin(docs, eq(docs.id, entityLinks.fromId))
          .where(
            and(
              eq(entityLinks.fromType, "doc"),
              eq(entityLinks.toType, "issue"),
              eq(entityLinks.toId, issueId),
              isNull(docs.deletedAt),
            ),
          )
          .orderBy(asc(docs.title)),
      );
      // One row per doc; a manual link wins over a mention of the same doc.
      const byDoc = new Map<string, LinkedDocView>();
      for (const row of rows) {
        if (!byDoc.has(row.id) || row.origin === "manual") byDoc.set(row.id, row);
      }
      return [...byDoc.values()];
    },

    /**
     * ADR-4 log: one row per live ADR, with the keys of the issues it links to. The links
     * statement finds the ADRs itself, so both statements run together.
     */
    async listAdrs(projectId: IdRef): Promise<AdrRow[]> {
      const successor = pgAlias(docs, "successor");
      const adr = pgAlias(docs, "adr");
      const [rows, links] = await Promise.all([
        read(
          db
            .select({
              id: docs.id,
              number: docs.adrNumber,
              title: docs.title,
              status: docs.adrStatus,
              supersededByNumber: successor.adrNumber,
              createdAt: docs.createdAt,
              updatedAt: docs.updatedAt,
            })
            .from(docs)
            .leftJoin(
              successor,
              and(eq(successor.id, docs.adrSupersededBy), isNull(successor.deletedAt)),
            )
            .where(and(eq(docs.projectId, projectId), eq(docs.type, "adr"), isNull(docs.deletedAt)))
            .orderBy(asc(docs.adrNumber)),
        ),
        read(
          db
            .select({ docId: entityLinks.fromId, number: issues.number, projectKey: projects.key })
            .from(entityLinks)
            .innerJoin(
              adr,
              and(
                eq(adr.id, entityLinks.fromId),
                eq(adr.projectId, projectId),
                eq(adr.type, "adr"),
                isNull(adr.deletedAt),
              ),
            )
            .innerJoin(issues, eq(issues.id, entityLinks.toId))
            .innerJoin(projects, eq(projects.id, issues.projectId))
            .where(
              and(
                eq(entityLinks.fromType, "doc"),
                eq(entityLinks.toType, "issue"),
                isNull(issues.deletedAt),
              ),
            )
            .orderBy(asc(issues.number)),
        ),
      ]);
      const keysByDoc = new Map<string, Set<string>>();
      for (const link of links) {
        const set = keysByDoc.get(link.docId) ?? new Set<string>();
        set.add(formatIssueKey(link.projectKey, link.number));
        keysByDoc.set(link.docId, set);
      }
      return rows.flatMap((row) =>
        row.number === null
          ? []
          : [
              {
                ...row,
                number: row.number,
                linkedIssueKeys: [...(keysByDoc.get(row.id) ?? [])],
              },
            ],
      );
    },

    /**
     * "Superseded by" choices (ADR-2): the project's other live ADRs. Empty unless `docId` is
     * a live ADR, so the doc page can ask before it knows the doc's type.
     */
    async supersedeOptions(projectId: IdRef, docId: string): Promise<DocRef[]> {
      const self = pgAlias(docs, "self");
      return read(
        db
          .select({ id: docs.id, title: docs.title })
          .from(docs)
          .where(
            and(
              eq(docs.projectId, projectId),
              eq(docs.type, "adr"),
              isNotNull(docs.adrNumber),
              isNull(docs.deletedAt),
              ne(docs.id, docId),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(self)
                  .where(and(eq(self.id, docId), eq(self.type, "adr"), isNull(self.deletedAt))),
              ),
            ),
          )
          .orderBy(asc(docs.adrNumber)),
      );
    },

    /** DOC-5 picker: built-in and custom doc templates. */
    async docTemplates(): Promise<DocTemplateView[]> {
      return read(
        db
          .select({
            id: templates.id,
            subtype: templates.subtype,
            name: templates.name,
            description: templates.description,
            content: templates.content,
          })
          .from(templates)
          .where(eq(templates.kind, "doc"))
          .orderBy(asc(templates.name)),
      );
    },

    /** Owner picker (DOC-4): every HQ user. */
    async listUsers(): Promise<UserOption[]> {
      return read(
        db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .orderBy(asc(users.name)),
      );
    },
  };
}

export type DocQueries = ReturnType<typeof createDocQueries>;
