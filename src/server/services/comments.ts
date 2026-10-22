import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { type CommentView } from "@/lib/issues/views";
import { extractUserMentionIds } from "@/lib/mentions";
import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import { comments, projects, users } from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { forbidden, notFound } from "./errors";
import {
  notificationsInsert,
  userMentionNotifyCtes,
  userMentionNotifyStatement,
} from "./notifications";
import { docRefs, type IdRef, mentionSyncCtes, mentionSyncStatement, rowsOf } from "./sql";

/**
 * ISS-7 comments on issues: anyone signed in can comment; only the author can edit or delete
 * (soft delete) their own comment. `STK-123` references in the body become `mention` entity
 * links from the comment to the issue, kept in sync on edit and removed on delete.
 */

export function createCommentService(
  db: AppDatabase,
  options: { runAtomic: RunAtomic; read?: Read },
) {
  const read = options.read ?? directRead;
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

  /** The comment exists, is not deleted and belongs to the actor. */
  const ownLiveComment = (commentId: string, actorId: string) =>
    sql`EXISTS (SELECT 1 FROM comments WHERE id = ${commentId}::uuid
      AND author_id = ${actorId}::uuid AND deleted_at IS NULL)`;

  return {
    async createComment(
      actorId: string,
      input: { issueId: string; body: RichTextDoc },
    ): Promise<{ id: string }> {
      const id = crypto.randomUUID();
      const text = extractPlainText(input.body);
      const refs = docRefs(input.body, await projectKeys());
      const created = sql`EXISTS (SELECT 1 FROM created)`;
      // One statement: the comment is new, so nobody else can be syncing its mentions. The
      // commenter starts watching the issue (ISS-11); the @mentioned users and the issue's
      // other watchers are notified with it (NTF-1). A watcher who is also mentioned gets
      // the mention only. Watchers added by this statement (the commenter) are not visible
      // to it, and the actor is never notified anyway.
      const result = await db.execute(sql`
        WITH created AS (
          INSERT INTO comments (id, entity_type, entity_id, author_id, body, body_text)
          SELECT ${id}::uuid, 'issue', i.id, ${actorId}::uuid, ${JSON.stringify(input.body)}::jsonb,
            ${text}
          FROM issues i WHERE i.id = ${input.issueId}::uuid AND i.deleted_at IS NULL
          RETURNING id, entity_id
        ),
        ${mentionSyncCtes({ fromType: "comment", fromId: id, refs, actorId, gate: created })},
        ${userMentionNotifyCtes(
          {
            fromType: "comment",
            fromId: id,
            userIds: extractUserMentionIds(input.body),
            actorId,
            gate: created,
          },
          {
            type: sql`'mentioned'`,
            entityType: sql`'issue'`,
            entityId: sql`${input.issueId}::uuid`,
            meta: sql`jsonb_build_object('commentId', ${id}::text)`,
          },
        )},
        commenter_watch AS (
          INSERT INTO watchers (issue_id, user_id)
          SELECT entity_id, ${actorId}::uuid FROM created
          ON CONFLICT DO NOTHING
        ),
        watchers_notified AS (
          ${notificationsInsert({
            actorId,
            source: sql`
              SELECT w.user_id, 'comment_on_watched'::text AS type, 'issue'::text AS entity_type,
                c.entity_id, 'comment:' || c.id::text AS event_key,
                jsonb_build_object('commentId', c.id::text) AS meta
              FROM created c JOIN watchers w ON w.issue_id = c.entity_id
              WHERE w.user_id NOT IN (SELECT user_id FROM user_mention_added)`,
          })}
        )
        SELECT id::text FROM created
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Issue");
      return { id };
    },

    async editComment(actorId: string, input: { commentId: string; body: RichTextDoc }) {
      const text = extractPlainText(input.body);
      const refs = docRefs(input.body, await projectKeys());
      // Ownership is part of the WHERE clause, so a non-author's edit changes nothing. The
      // mention sync is a second statement in the same transaction, after the row lock.
      const [result] = await options.runAtomic([
        sql`
          UPDATE comments
          SET body = ${JSON.stringify(input.body)}::jsonb, body_text = ${text},
            edited_at = now(), updated_at = now()
          WHERE id = ${input.commentId}::uuid AND author_id = ${actorId}::uuid
            AND deleted_at IS NULL
          RETURNING id::text
        `,
        mentionSyncStatement({
          fromType: "comment",
          fromId: input.commentId,
          refs,
          actorId,
          gate: ownLiveComment(input.commentId, actorId),
        }),
        // NTF-1: only users newly mentioned by this edit are notified, in the same batch.
        userMentionNotifyStatement(
          {
            fromType: "comment",
            fromId: input.commentId,
            userIds: extractUserMentionIds(input.body),
            actorId,
            gate: ownLiveComment(input.commentId, actorId),
          },
          {
            type: sql`(SELECT CASE WHEN entity_type = 'doc' THEN 'mentioned_in_doc'
              ELSE 'mentioned' END FROM comments WHERE id = ${input.commentId}::uuid)`,
            entityType: sql`(SELECT entity_type::text FROM comments
              WHERE id = ${input.commentId}::uuid)`,
            entityId: sql`(SELECT entity_id FROM comments WHERE id = ${input.commentId}::uuid)`,
            meta: sql`jsonb_build_object('commentId', ${input.commentId}::text)`,
          },
        ),
      ]);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        await explainMiss(input.commentId);
      }
    },

    async deleteComment(actorId: string, commentId: string) {
      const [result] = await options.runAtomic([
        sql`
          UPDATE comments SET deleted_at = now(), updated_at = now()
          WHERE id = ${commentId}::uuid AND author_id = ${actorId}::uuid AND deleted_at IS NULL
          RETURNING id::text
        `,
        // Second statement: also sees links a concurrent edit committed while we waited.
        sql`
          DELETE FROM entity_links
          WHERE from_type = 'comment' AND from_id = ${commentId}::uuid
            AND EXISTS (SELECT 1 FROM comments WHERE id = ${commentId}::uuid
              AND author_id = ${actorId}::uuid AND deleted_at IS NOT NULL)
        `,
      ]);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        await explainMiss(commentId);
      }
    },

    async listForIssue(issueId: IdRef): Promise<CommentView[]> {
      return read(
        db
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
          .orderBy(asc(comments.createdAt)),
      );
    },
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
