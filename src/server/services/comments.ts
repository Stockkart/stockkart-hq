import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { extractIssueRefs } from "@/lib/issues/keys";
import { type CommentView } from "@/lib/issues/views";
import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import { comments, projects, users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { forbidden, notFound } from "./errors";
import { mentionSyncCtes, rowsOf } from "./sql";

/**
 * ISS-7 comments on issues: anyone signed in can comment; only the author can edit or delete
 * (soft delete) their own comment. `STK-123` references in the body become `mention` entity
 * links from the comment to the issue, kept in sync on edit and removed on delete.
 */

export function createCommentService(db: AppDatabase) {
  async function projectKeys(): Promise<string[]> {
    const rows = await db.select({ key: projects.key }).from(projects);
    return rows.map((row) => row.key);
  }

  /** Distinguishes "not yours" from "does not exist" after a guarded write matched nothing. */
  async function explainMiss(commentId: string): Promise<never> {
    const [row] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
      .limit(1);
    throw row ? forbidden("You can only change your own comments") : notFound("Comment");
  }

  return {
    async createComment(
      actorId: string,
      input: { issueId: string; body: RichTextDoc },
    ): Promise<{ id: string }> {
      const id = crypto.randomUUID();
      const text = extractPlainText(input.body);
      const refs = extractIssueRefs(text, await projectKeys());
      const result = await db.execute(sql`
        WITH created AS (
          INSERT INTO comments (id, entity_type, entity_id, author_id, body, body_text)
          SELECT ${id}::uuid, 'issue', i.id, ${actorId}::uuid, ${JSON.stringify(input.body)}::jsonb,
            ${text}
          FROM issues i WHERE i.id = ${input.issueId}::uuid AND i.deleted_at IS NULL
          RETURNING id
        ),
        ${mentionSyncCtes({
          fromType: "comment",
          fromId: id,
          refs,
          actorId,
          gate: sql`EXISTS (SELECT 1 FROM created)`,
        })}
        SELECT id::text FROM created
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Issue");
      return { id };
    },

    async editComment(actorId: string, input: { commentId: string; body: RichTextDoc }) {
      const text = extractPlainText(input.body);
      const refs = extractIssueRefs(text, await projectKeys());
      // Ownership is part of the WHERE clause, so a non-author's edit changes nothing.
      const result = await db.execute(sql`
        WITH edited AS (
          UPDATE comments
          SET body = ${JSON.stringify(input.body)}::jsonb, body_text = ${text},
            edited_at = now(), updated_at = now()
          WHERE id = ${input.commentId}::uuid AND author_id = ${actorId}::uuid
            AND deleted_at IS NULL
          RETURNING id
        ),
        ${mentionSyncCtes({
          fromType: "comment",
          fromId: input.commentId,
          refs,
          actorId,
          gate: sql`EXISTS (SELECT 1 FROM edited)`,
        })}
        SELECT id::text FROM edited
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        await explainMiss(input.commentId);
      }
    },

    async deleteComment(actorId: string, commentId: string) {
      const result = await db.execute(sql`
        WITH deleted AS (
          UPDATE comments SET deleted_at = now(), updated_at = now()
          WHERE id = ${commentId}::uuid AND author_id = ${actorId}::uuid AND deleted_at IS NULL
          RETURNING id
        ),
        unlinked AS (
          DELETE FROM entity_links
          WHERE from_type = 'comment' AND from_id IN (SELECT id FROM deleted)
        )
        SELECT id::text FROM deleted
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        await explainMiss(commentId);
      }
    },

    async listForIssue(issueId: string): Promise<CommentView[]> {
      return db
        .select({
          id: comments.id,
          authorId: comments.authorId,
          authorName: users.name,
          body: comments.body,
          createdAt: comments.createdAt,
          editedAt: comments.editedAt,
        })
        .from(comments)
        .leftJoin(users, eq(users.id, comments.authorId))
        .where(
          and(
            eq(comments.entityType, "issue"),
            eq(comments.entityId, issueId),
            isNull(comments.deletedAt),
          ),
        )
        .orderBy(asc(comments.createdAt));
    },
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
