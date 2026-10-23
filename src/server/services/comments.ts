import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { type CreateDocCommentData } from "@/lib/doc-comments/schemas";
import { type DocThreadView, groupThreads } from "@/lib/doc-comments/views";
import { type CommentView } from "@/lib/issues/views";
import { extractUserMentionIds } from "@/lib/mentions";
import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import { comments, docs, projects, users } from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { forbidden, invalid, notFound } from "./errors";
import {
  notificationsInsert,
  userMentionNotifyCtes,
  userMentionNotifyStatement,
} from "./notifications";
import {
  docRefs,
  type IdRef,
  mentionSyncCtes,
  mentionSyncStatement,
  rowsOf,
  uuidOrNull,
} from "./sql";

/** Who resolved a doc thread (DOC-13). */
const resolver = pgAlias(users, "comment_resolver");

/**
 * ISS-7 comments on issues: anyone signed in can comment; only the author can edit or delete
 * (soft delete) their own comment. `STK-123` references in the body become `mention` entity
 * links from the comment to the issue, kept in sync on edit and removed on delete. Doc
 * comments (DOC-11, DOC-13) share edit and delete; they add threads, anchors and
 * resolution (see below).
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

    // ── Doc comments: page-level (DOC-11) and inline, anchored threads (DOC-13) ──────────

    /**
     * A new thread on a doc (page-level, or inline with `anchor`: the mark's id and the
     * quoted selection) or a reply to a thread's top comment (one level deep, like the
     * `comments_reply_plain` CHECK). ONE statement: the comment, its `STK-123` and @user
     * mention links, the mention bell entries, and `comment_on_doc` for the doc owner and the
     * thread's earlier participants. Someone who is also @mentioned gets the mention only;
     * duplicates collapse (one row per user and event) and the actor is never notified.
     */
    async createDocComment(
      actorId: string,
      input: CreateDocCommentData,
    ): Promise<{ id: string; threadId: string }> {
      const id = crypto.randomUUID();
      const parentId = input.parentId ?? null;
      const threadId = parentId ?? id;
      const text = extractPlainText(input.body);
      const refs = docRefs(input.body, await projectKeys());
      const created = sql`EXISTS (SELECT 1 FROM created)`;
      // A deleted top comment still holds its thread while it has live replies (shown as a
      // placeholder), so it can still be replied to; it must be a top comment on this doc.
      const parentGate = parentId
        ? sql`EXISTS (SELECT 1 FROM comments p WHERE p.id = ${parentId}::uuid
            AND p.entity_type = 'doc' AND p.entity_id = ${input.docId}::uuid
            AND p.parent_id IS NULL
            AND (p.deleted_at IS NULL OR EXISTS (SELECT 1 FROM comments r
              WHERE r.parent_id = p.id AND r.deleted_at IS NULL)))`
        : sql`TRUE`;
      // Earlier participants: the thread's live comments (a new thread has none yet).
      const participants = parentId
        ? sql`UNION SELECT author_id FROM comments
            WHERE (id = ${parentId}::uuid OR parent_id = ${parentId}::uuid) AND deleted_at IS NULL`
        : sql``;
      const result = await db.execute(sql`
        WITH target_doc AS (
          SELECT id, owner_id FROM docs WHERE id = ${input.docId}::uuid AND deleted_at IS NULL
        ),
        created AS (
          INSERT INTO comments (id, entity_type, entity_id, author_id, body, body_text,
            anchor_id, anchor_text, parent_id)
          SELECT ${id}::uuid, 'doc', d.id, ${actorId}::uuid, ${JSON.stringify(input.body)}::jsonb,
            ${text}, ${input.anchor?.id ?? null}::text, ${input.anchor?.text ?? null}::text,
            ${uuidOrNull(parentId)}
          FROM target_doc d WHERE ${parentGate}
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
            type: sql`'mentioned_in_doc'`,
            entityType: sql`'doc'`,
            entityId: sql`${input.docId}::uuid`,
            meta: sql`jsonb_build_object('commentId', ${id}::text)`,
          },
        )},
        doc_comment_notified AS (
          ${notificationsInsert({
            actorId,
            source: sql`
              SELECT r.user_id, 'comment_on_doc'::text AS type, 'doc'::text AS entity_type,
                c.entity_id, 'comment:' || c.id::text AS event_key,
                jsonb_build_object('commentId', c.id::text, 'threadId', ${threadId}::text) AS meta
              FROM created c
              CROSS JOIN (SELECT owner_id AS user_id FROM target_doc ${participants}) r
              WHERE r.user_id NOT IN (SELECT user_id FROM user_mention_added)`,
          })}
        )
        SELECT id::text FROM created
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        const [doc] = await db
          .select({ id: docs.id })
          .from(docs)
          .where(and(eq(docs.id, input.docId), isNull(docs.deletedAt)))
          .limit(1);
        if (!doc) throw notFound("Doc");
        throw invalid("Reply to the first comment of a thread on this doc");
      }
      return { id, threadId };
    },

    /**
     * DOC-13 resolve (true) or reopen (false) a thread, on its top comment. Anyone signed
     * in may do it. `resolved_at` and `resolved_by` change together (CHECK), and the change
     * is logged in `activity` (`comment` entity) in the same statement. Repeating the same
     * choice changes nothing and logs nothing.
     */
    async setThreadResolved(
      actorId: string,
      input: { commentId: string; resolved: boolean },
    ): Promise<{ resolvedAt: Date | null }> {
      const resolved = sql`${input.resolved}::boolean`;
      const result = await db.execute(sql`
        WITH target AS (
          SELECT c.id, c.resolved_at FROM comments c
          JOIN docs d ON d.id = c.entity_id AND d.deleted_at IS NULL
          -- A deleted top comment keeps its thread while it has live replies (placeholder),
          -- so it stays resolvable; a hidden one (no live replies) does not.
          WHERE c.id = ${input.commentId}::uuid AND c.entity_type = 'doc'
            AND c.parent_id IS NULL
            AND (c.deleted_at IS NULL OR EXISTS (SELECT 1 FROM comments r
              WHERE r.parent_id = c.id AND r.deleted_at IS NULL))
          FOR UPDATE OF c
        ),
        updated AS (
          UPDATE comments c
          SET resolved_at = CASE WHEN ${resolved} THEN now() END,
            resolved_by = CASE WHEN ${resolved} THEN ${actorId}::uuid END,
            updated_at = now()
          FROM target t
          WHERE c.id = t.id AND (t.resolved_at IS NULL) = ${resolved}
          RETURNING c.id, t.resolved_at AS before, c.resolved_at AS after
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'comment', id, ${actorId}::uuid,
            CASE WHEN ${resolved} THEN 'resolved' ELSE 'reopened' END, 'resolved_at',
            to_jsonb(before) #>> '{}', to_jsonb(after) #>> '{}'
          FROM updated
        )
        SELECT CASE WHEN EXISTS (SELECT 1 FROM updated) THEN (SELECT after FROM updated)
            ELSE (SELECT resolved_at FROM target) END AS resolved_at,
          EXISTS (SELECT 1 FROM target) AS found
      `);
      const [row] = rowsOf(
        result,
        z.object({ resolved_at: z.coerce.date().nullable(), found: z.boolean() }),
      );
      if (!row?.found) throw notFound("Thread");
      return { resolvedAt: row.resolved_at };
    },

    /**
     * The doc's comment threads, oldest first (the panel orders inline ones by where their
     * text is). A deleted comment's body never leaves the database: a deleted top comment
     * comes back as a placeholder only while it has live replies.
     */
    async listForDoc(docId: IdRef): Promise<DocThreadView[]> {
      const rows = await read(
        db
          .select({
            id: comments.id,
            parentId: comments.parentId,
            authorId: comments.authorId,
            authorName: users.name,
            body: sql<RichTextDoc | null>`CASE WHEN ${comments.deletedAt} IS NULL
              THEN ${comments.body} END`,
            createdAt: comments.createdAt,
            editedAt: comments.editedAt,
            anchorId: comments.anchorId,
            anchorText: comments.anchorText,
            resolvedAt: comments.resolvedAt,
            resolvedByName: resolver.name,
            deleted: sql<boolean>`${comments.deletedAt} IS NOT NULL`,
          })
          .from(comments)
          .leftJoin(users, eq(users.id, comments.authorId))
          .leftJoin(resolver, eq(resolver.id, comments.resolvedBy))
          .where(
            and(
              eq(comments.entityType, "doc"),
              eq(comments.entityId, docId),
              // Deleted replies are never shown; deleted top comments maybe (placeholder).
              or(isNull(comments.deletedAt), isNull(comments.parentId)),
            ),
          )
          .orderBy(asc(comments.createdAt), asc(comments.id)),
      );
      return groupThreads(rows);
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
