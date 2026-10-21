import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { formatIssueKey, issuePath } from "@/lib/issues/keys";
import { type MentionItem, type MentionUser } from "@/lib/notifications/views";
import { directRead, type Read } from "@/server/db/read-batch";
import { comments, docs, entityLinks, issues, projects, users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

/** Users offered by the @mention list; HQ is a small team, so the client filters them. */
const MENTIONABLE_USERS_MAX = 500;

const issueProject = pgAlias(projects, "mention_issue_project");
const docProject = pgAlias(projects, "mention_doc_project");
const mentioner = pgAlias(users, "mention_author");

/**
 * @user mentions (ISS-7, DOC-9, MY-1): who can be mentioned, and where someone mentioned a
 * user. The `mention` entity links (`to_type = 'user'`) are written by the issue, comment
 * and doc saves (`userMentionSyncCtes`).
 */
export function createMentionQueries(db: AppDatabase, { read = directRead }: { read?: Read } = {}) {
  return {
    async mentionableUsers(): Promise<MentionUser[]> {
      return read(
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .orderBy(asc(users.name), asc(users.id))
          .limit(MENTIONABLE_USERS_MAX),
      );
    },

    /**
     * MY-1 "Mentions": the latest places others mentioned `userId` (an issue description, a
     * comment, a doc), newest first. Mentions in deleted things and self-mentions are left
     * out; a comment counts as its issue (or doc).
     */
    async listMentionsOf(userId: string, limit: number): Promise<MentionItem[]> {
      const issueId = sql`CASE WHEN ${entityLinks.fromType} = 'issue' THEN ${entityLinks.fromId}
        WHEN ${comments.entityType} = 'issue' THEN ${comments.entityId} END`;
      const docId = sql`CASE WHEN ${entityLinks.fromType} = 'doc' THEN ${entityLinks.fromId}
        WHEN ${comments.entityType} = 'doc' THEN ${comments.entityId} END`;
      const rows = await read(
        db
          .select({
            id: entityLinks.id,
            fromType: entityLinks.fromType,
            createdAt: entityLinks.createdAt,
            mentionedByName: mentioner.name,
            issueNumber: issues.number,
            issueTitle: issues.title,
            issueProjectKey: issueProject.key,
            docId: docs.id,
            docTitle: docs.title,
            docProjectKey: docProject.key,
          })
          .from(entityLinks)
          .leftJoin(
            comments,
            and(
              eq(entityLinks.fromType, "comment"),
              eq(comments.id, entityLinks.fromId),
              isNull(comments.deletedAt),
            ),
          )
          .leftJoin(issues, and(eq(issues.id, issueId), isNull(issues.deletedAt)))
          .leftJoin(issueProject, eq(issueProject.id, issues.projectId))
          .leftJoin(docs, and(eq(docs.id, docId), isNull(docs.deletedAt)))
          .leftJoin(docProject, eq(docProject.id, docs.projectId))
          .leftJoin(mentioner, eq(mentioner.id, entityLinks.createdBy))
          .where(
            and(
              eq(entityLinks.toType, "user"),
              eq(entityLinks.toId, userId),
              eq(entityLinks.origin, "mention"),
              sql`${entityLinks.createdBy} IS DISTINCT FROM ${userId}::uuid`,
              or(isNotNull(issues.id), isNotNull(docs.id)),
            ),
          )
          .orderBy(desc(entityLinks.createdAt), desc(entityLinks.id))
          .limit(limit),
      );
      return rows.flatMap((row): MentionItem[] => {
        const source =
          row.fromType === "comment" ? "comment" : row.fromType === "doc" ? "doc" : "issue";
        const base = {
          id: row.id,
          source,
          mentionedByName: row.mentionedByName,
          mentionedAt: row.createdAt,
        } as const;
        if (row.issueNumber !== null && row.issueTitle !== null && row.issueProjectKey !== null) {
          return [
            {
              ...base,
              target: {
                kind: "issue",
                key: formatIssueKey(row.issueProjectKey, row.issueNumber),
                title: row.issueTitle,
                href: issuePath(row.issueProjectKey, row.issueNumber),
              },
            },
          ];
        }
        if (row.docId !== null && row.docTitle !== null && row.docProjectKey !== null) {
          return [
            {
              ...base,
              target: {
                kind: "doc",
                title: row.docTitle,
                href: `/${row.docProjectKey}/docs/${row.docId}`,
              },
            },
          ];
        }
        return [];
      });
    },
  };
}

export type MentionQueries = ReturnType<typeof createMentionQueries>;
