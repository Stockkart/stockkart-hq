import { randomUUID } from "node:crypto";

import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type AttachmentEntityType, ATTACHMENT_ENTITY_TYPES } from "@/lib/attachments/constants";
import { classifyUpload, normalizeMime, type UploadClass } from "@/lib/attachments/policy";
import { type StartUploadInput } from "@/lib/attachments/schemas";
import { type AttachmentView, type StartedUpload } from "@/lib/attachments/views";
import { type AppDatabase } from "@/server/db/types";
import {
  STORAGE_NOT_CONFIGURED_MESSAGE,
  StorageInputError,
  StorageNotConfigured,
} from "@/server/storage/errors";
import { attachmentKey } from "@/server/storage/keys";
import { type Storage } from "@/server/storage/storage";

import { forbidden, invalid, notFound } from "./errors";
import { rowsOf } from "./sql";

/**
 * ISS-9 uploads, direct browser → R2 (Vercel function bodies cap at ~4.5 MB):
 *
 *   1. `startUpload`: the parent must be live; the policy picks the stored type; a `pending`
 *      row is inserted (at most `PENDING_LIMIT` per user per `PENDING_WINDOW_MINUTES`) and a
 *      presigned PUT (5 min, type and length signed) is returned.
 *   2. The browser PUTs the bytes with exactly the signed headers.
 *   3. `confirmUpload`: HEAD the object; size and type must match the row, otherwise the
 *      object and the row are deleted. Then `ready`, with an activity row.
 *
 * Pending rows that never got confirmed are purged after `PENDING_MAX_AGE_HOURS`, a few at a
 * time on every `startUpload` and fully by `scripts/purge-pending-uploads.ts`. Pending rows
 * are the only attachment rows ever hard-deleted; `ready` ones are soft-deleted and their
 * objects kept (§9.3).
 */

/**
 * Abuse limit on pending uploads per user and window. Checked in the insert statement, so
 * it holds for sequential requests; parallel requests from the same user can each see the
 * count just below the limit and overshoot it by at most their concurrency (accepted: a
 * signed-in staff member, 10 MB each, purged after a day).
 */
export const PENDING_LIMIT = 20;
export const PENDING_WINDOW_MINUTES = 10;
export const PENDING_MAX_AGE_HOURS = 24;
/** How many stale pending uploads one `startUpload` cleans up on the side (cheap, bounded). */
export const OPPORTUNISTIC_PURGE_LIMIT = 5;
/**
 * A pending upload can be confirmed for this long (the signed PUT lives 5 minutes), well
 * before the purge may delete its object, so a confirm never races the purge.
 */
export const CONFIRM_WINDOW_MINUTES = 60;

export type AttachmentStorage = Pick<
  Storage,
  "storageConfigured" | "presignUpload" | "headObject" | "deleteObject"
>;

/**
 * Whether the parent of an attachment is live: the issue or doc is not deleted, and for a
 * comment, the comment and the issue or doc it is on are not deleted. Used by the upload
 * check and by the download route (a deleted parent's files 404 like the parent does).
 * With `commentAuthorId` (uploads), a comment only counts when that user wrote it: nobody
 * attaches files to someone else's comment.
 */
export function liveAttachmentParent(
  entityType: SQL,
  entityId: SQL,
  { commentAuthorId }: { commentAuthorId?: string } = {},
): SQL {
  const author = commentAuthorId ? sql`AND pc.author_id = ${commentAuthorId}::uuid` : sql``;
  return sql`(CASE (${entityType})::text
    WHEN 'issue' THEN EXISTS (
      SELECT 1 FROM issues pi WHERE pi.id = ${entityId} AND pi.deleted_at IS NULL)
    WHEN 'doc' THEN EXISTS (
      SELECT 1 FROM docs pd WHERE pd.id = ${entityId} AND pd.deleted_at IS NULL)
    WHEN 'comment' THEN EXISTS (
      SELECT 1 FROM comments pc
      WHERE pc.id = ${entityId} AND pc.deleted_at IS NULL ${author}
        AND CASE pc.entity_type::text
          WHEN 'issue' THEN EXISTS (
            SELECT 1 FROM issues pci WHERE pci.id = pc.entity_id AND pci.deleted_at IS NULL)
          WHEN 'doc' THEN EXISTS (
            SELECT 1 FROM docs pcd WHERE pcd.id = pc.entity_id AND pcd.deleted_at IS NULL)
          ELSE false END)
    ELSE false END)`;
}

/** The name we keep for display: the last path segment, as typed (the key is sanitized). */
export function displayFilename(filename: string): string {
  return (filename.split(/[/\\]/).pop() ?? "").trim() || "file";
}

/**
 * The stored upload class for a file. Classified from the browser's type and the display
 * name, then again against the object key (its sanitized name), until both agree: the
 * storage module re-checks `classifyUpload(type, key)` before signing, and a `.csv` sent as
 * `application/vnd.ms-excel` (→ octet-stream → `text/csv` by extension) or a name whose
 * sanitized form is an SVG must not fail or slip through there. Each step only moves to a
 * canonical type (the policy is idempotent after at most two passes); the bound is a guard.
 */
export function storedUploadClass(mime: string, filename: string, key: string): UploadClass {
  let upload = classifyUpload(mime, filename);
  for (let pass = 0; pass < 3; pass += 1) {
    const again = classifyUpload(upload.contentType, key);
    if (again.contentType === upload.contentType && again.category === upload.category) break;
    upload = again;
  }
  return upload;
}

/** `text/plain; charset=utf-8` vs `text/plain;charset=UTF-8`: same type. */
function sameContentType(stored: string | null, expected: string): boolean {
  if (stored === null) return false;
  const canonical = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  return canonical(stored) === canonical(expected) || normalizeMime(stored) === expected;
}

const dateish = z.union([z.date(), z.string()]).transform((value) => new Date(value));

const viewRow = z.object({
  id: z.string(),
  entity_type: z.enum(ATTACHMENT_ENTITY_TYPES),
  entity_id: z.string(),
  filename: z.string(),
  mime: z.string(),
  size_bytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  uploaded_by: z.string().nullable(),
  uploader_name: z.string().nullable(),
  created_at: dateish,
});

function toView(row: z.infer<typeof viewRow>): AttachmentView {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    uploadedBy: row.uploaded_by,
    uploaderName: row.uploader_name,
    createdAt: row.created_at,
  };
}

/** Columns of `viewRow` from an `attachments` row aliased `a`, uploader from `u`. */
const VIEW_COLUMNS = sql.raw(`a.id::text AS id, a.entity_type::text AS entity_type,
  a.entity_id::text AS entity_id, a.filename, a.mime, a.size_bytes, a.width, a.height,
  a.uploaded_by::text AS uploaded_by, u.name AS uploader_name, a.created_at`);

/**
 * The activity row for an attachment change, as an INSERT … SELECT over `source` (a CTE with
 * the attachment's id, entity_type, entity_id and filename). On an issue it goes to the
 * issue's own history (ISS-8: "attached shot.png"); elsewhere it is an `attachment` row.
 */
function activityInsert(source: string, actorId: string, issueAction: string, otherAction: string) {
  return sql`INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
    SELECT
      CASE WHEN s.entity_type::text = 'issue' THEN 'issue'::entity_type
        ELSE 'attachment'::entity_type END,
      CASE WHEN s.entity_type::text = 'issue' THEN s.entity_id ELSE s.id END,
      ${actorId}::uuid,
      CASE WHEN s.entity_type::text = 'issue' THEN ${issueAction} ELSE ${otherAction} END,
      jsonb_build_object('name', s.filename, 'attachmentId', s.id,
        'entityType', s.entity_type::text, 'entityId', s.entity_id)
    FROM ${sql.raw(source)} s`;
}

export function createAttachmentService(
  db: AppDatabase,
  deps: { storage: AttachmentStorage; newId?: () => string },
) {
  const { storage } = deps;
  const newId = deps.newId ?? randomUUID;

  function requireStorage(): void {
    if (!storage.storageConfigured()) throw invalid(STORAGE_NOT_CONFIGURED_MESSAGE);
  }

  /** Storage failures the user can act on become `invalid`; anything else propagates. */
  function storageError(error: unknown): never {
    if (error instanceof StorageNotConfigured) throw invalid(STORAGE_NOT_CONFIGURED_MESSAGE);
    if (error instanceof StorageInputError) throw invalid("This file can't be uploaded");
    throw error;
  }

  async function deletePendingRow(id: string): Promise<void> {
    await db.execute(sql`DELETE FROM attachments WHERE id = ${id}::uuid AND status = 'pending'`);
  }

  const service = {
    async startUpload(actorId: string, input: StartUploadInput): Promise<StartedUpload> {
      requireStorage();
      const filename = displayFilename(input.filename);
      const id = newId();
      const key = attachmentKey(filename, id);
      // The client's type and name are untrusted; the policy decides what is stored.
      const policy = storedUploadClass(input.mime, filename, key);
      const isImage = policy.category === "image";
      const width = isImage ? (input.width ?? null) : null;
      const height = isImage ? (input.height ?? null) : null;

      // ONE statement: the parent check, the pending limit and the insert, so neither check
      // can go stale before the row exists.
      const result = await db.execute(sql`
        WITH parent AS (
          SELECT ${liveAttachmentParent(sql`${input.entityType}`, sql`${input.entityId}::uuid`, {
            commentAuthorId: actorId,
          })} AS live
        ),
        recent AS (
          SELECT count(*)::int AS pending FROM attachments
          WHERE uploaded_by = ${actorId}::uuid AND status = 'pending'
            AND created_at > now() - make_interval(mins => ${PENDING_WINDOW_MINUTES})
        ),
        inserted AS (
          INSERT INTO attachments
            (id, entity_type, entity_id, storage_key, filename, mime, size_bytes, width, height,
             uploaded_by, status)
          SELECT ${id}::uuid, ${input.entityType}::attachment_entity_type,
            ${input.entityId}::uuid, ${key}, ${filename}, ${policy.contentType}, ${input.size},
            ${width}::int, ${height}::int, ${actorId}::uuid, 'pending'
          FROM parent, recent
          WHERE parent.live AND recent.pending < ${PENDING_LIMIT}
          RETURNING id
        )
        SELECT parent.live, recent.pending, (SELECT count(*)::int FROM inserted) AS inserted
        FROM parent, recent
      `);
      const [row] = rowsOf(
        result,
        z.object({ live: z.boolean(), pending: z.number(), inserted: z.number() }),
      );
      if (!row?.live) throw notFound(entityLabel(input.entityType));
      if (row.inserted === 0) {
        throw invalid(
          `Too many uploads in progress; wait a few minutes and try again (at most ${PENDING_LIMIT} per ${PENDING_WINDOW_MINUTES} minutes)`,
        );
      }

      const [presigned] = await Promise.all([
        storage
          .presignUpload({ key, contentType: policy.contentType, contentLength: input.size })
          .catch(async (error: unknown) => {
            await deletePendingRow(id);
            return storageError(error);
          }),
        // Housekeeping on the side; never fails the upload.
        service.purgeStalePending(OPPORTUNISTIC_PURGE_LIMIT).catch(() => 0),
      ]);
      return {
        attachmentId: id,
        url: presigned.url,
        method: presigned.method,
        headers: { ...presigned.headers },
        filename,
      };
    },

    /**
     * Checks the uploaded object against the row (HEAD: size and type) and marks it `ready`.
     * Only the uploader can confirm. A mismatch or a missing object deletes both, so a
     * failed or tampered upload leaves nothing behind.
     */
    async confirmUpload(actorId: string, attachmentId: string): Promise<AttachmentView> {
      requireStorage();
      const [row] = rowsOf(
        await db.execute(sql`
          SELECT storage_key, mime, size_bytes, status::text AS status FROM attachments
          WHERE id = ${attachmentId}::uuid AND uploaded_by = ${actorId}::uuid
            AND deleted_at IS NULL
            AND (status = 'ready'
              OR created_at > now() - make_interval(mins => ${CONFIRM_WINDOW_MINUTES}))
        `),
        z.object({
          storage_key: z.string(),
          mime: z.string(),
          size_bytes: z.number(),
          status: z.string(),
        }),
      );
      if (!row) throw notFound("Upload");
      if (row.status === "pending") {
        const head = await storage.headObject(row.storage_key).catch(storageError);
        const matches =
          head !== null &&
          head.sizeBytes === row.size_bytes &&
          sameContentType(head.contentType, row.mime);
        if (!matches) {
          if (head) await storage.deleteObject(row.storage_key).catch(storageError);
          await deletePendingRow(attachmentId);
          throw invalid(
            head
              ? "The uploaded file didn't match what was announced; try again"
              : "The upload didn't arrive; try again",
          );
        }
      }
      const result = await db.execute(sql`
        WITH updated AS (
          UPDATE attachments SET status = 'ready', updated_at = now()
          WHERE id = ${attachmentId}::uuid AND status = 'pending' AND deleted_at IS NULL
            AND created_at > now() - make_interval(mins => ${CONFIRM_WINDOW_MINUTES})
          RETURNING id, entity_type, entity_id, filename
        ),
        logged AS (${activityInsert("updated", actorId, "attachment_added", "uploaded")})
        SELECT ${VIEW_COLUMNS} FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.id = ${attachmentId}::uuid AND a.deleted_at IS NULL
      `);
      const [view] = rowsOf(result, viewRow);
      if (!view) throw notFound("Upload");
      // The statement's snapshot predates its own UPDATE, so `view` may still say pending;
      // it is ready now either way (or was already: confirming twice is harmless).
      return toView(view);
    },

    /** The uploader gives up on a pending upload (the PUT failed): drop the row and object. */
    async cancelUpload(actorId: string, attachmentId: string): Promise<void> {
      const [row] = rowsOf(
        await db.execute(sql`
          DELETE FROM attachments
          WHERE id = ${attachmentId}::uuid AND uploaded_by = ${actorId}::uuid
            AND status = 'pending'
          RETURNING storage_key
        `),
        z.object({ storage_key: z.string() }),
      );
      if (!row) throw notFound("Upload");
      if (storage.storageConfigured()) {
        // Best effort: an object that never arrived is simply not there.
        await storage.deleteObject(row.storage_key).catch(() => undefined);
      }
    },

    /** Soft delete (the object stays, §9.3). Only the uploader may delete. */
    async deleteAttachment(
      actorId: string,
      attachmentId: string,
    ): Promise<{ entityType: AttachmentEntityType }> {
      const result = await db.execute(sql`
        WITH target AS (
          SELECT id, entity_type, entity_id, filename, uploaded_by FROM attachments
          WHERE id = ${attachmentId}::uuid AND status = 'ready' AND deleted_at IS NULL
        ),
        deleted AS (
          UPDATE attachments a SET deleted_at = now(), updated_at = now()
          FROM target
          WHERE a.id = target.id AND target.uploaded_by = ${actorId}::uuid
            AND a.deleted_at IS NULL
          RETURNING a.id, a.entity_type, a.entity_id, a.filename
        ),
        logged AS (${activityInsert("deleted", actorId, "attachment_removed", "deleted")})
        SELECT (SELECT entity_type::text FROM target) AS entity_type,
          COALESCE((SELECT uploaded_by = ${actorId}::uuid FROM target), false) AS own,
          (SELECT count(*)::int FROM deleted) AS deleted
      `);
      const [row] = rowsOf(
        result,
        z.object({
          entity_type: z.enum(ATTACHMENT_ENTITY_TYPES).nullable(),
          own: z.boolean(),
          deleted: z.number(),
        }),
      );
      if (!row?.entity_type) throw notFound("Attachment");
      if (row.deleted === 0) {
        // Own but not deleted: a concurrent delete got there first.
        if (row.own) throw notFound("Attachment");
        throw forbidden("Only the person who uploaded a file can delete it");
      }
      return { entityType: row.entity_type };
    },

    /**
     * A new comment's files were uploaded while it was a draft, as attachments of its issue
     * (or doc); once the comment exists they move onto it, so they show inline only. Only
     * the comment's author moves only their own uploads from that same parent.
     */
    async adoptForComment(
      actorId: string,
      input: { commentId: string; attachmentIds: string[] },
    ): Promise<{ moved: number }> {
      const ids = sql.join(
        input.attachmentIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const result = await db.execute(sql`
        WITH c AS (
          SELECT id, entity_type::text AS entity_type, entity_id FROM comments
          WHERE id = ${input.commentId}::uuid AND author_id = ${actorId}::uuid
            AND deleted_at IS NULL
        ),
        moved AS (
          UPDATE attachments a
          SET entity_type = 'comment', entity_id = c.id, updated_at = now()
          FROM c
          WHERE a.id IN (${ids}) AND a.entity_type::text = c.entity_type
            AND a.entity_id = c.entity_id AND a.uploaded_by = ${actorId}::uuid
            AND a.deleted_at IS NULL
          RETURNING a.id, c.entity_type AS from_type, c.entity_id AS from_id
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value, to_value)
          SELECT 'attachment'::entity_type, m.id, ${actorId}::uuid, 'updated', 'entity',
            m.from_type || ':' || m.from_id::text, 'comment:' || ${input.commentId}::text
          FROM moved m
        )
        SELECT (SELECT count(*)::int FROM c) AS comments, (SELECT count(*)::int FROM moved) AS moved
      `);
      const [row] = rowsOf(result, z.object({ comments: z.number(), moved: z.number() }));
      if (!row || row.comments === 0) throw notFound("Comment");
      return { moved: row.moved };
    },

    /**
     * Deletes pending uploads older than `PENDING_MAX_AGE_HOURS` (their PUT URL expired long
     * ago): objects first, then the rows, so a failure leaves a row to retry rather than an
     * object nobody knows about. Returns how many rows went.
     */
    async purgeStalePending(limit: number): Promise<number> {
      if (!storage.storageConfigured()) return 0;
      const stale = rowsOf(
        await db.execute(sql`
          SELECT id::text AS id, storage_key FROM attachments
          WHERE status = 'pending'
            AND created_at < now() - make_interval(hours => ${PENDING_MAX_AGE_HOURS})
          ORDER BY created_at
          LIMIT ${limit}
        `),
        z.object({ id: z.string(), storage_key: z.string() }),
      );
      // Per row, so one object that cannot be deleted never blocks the rest; its row stays
      // and is retried next time.
      const removed: typeof stale = [];
      for (const row of stale) {
        try {
          await storage.deleteObject(row.storage_key);
          removed.push(row);
        } catch {
          // Left for the next run.
        }
      }
      if (removed.length === 0) return 0;
      const deleted = rowsOf(
        await db.execute(sql`
          DELETE FROM attachments
          WHERE status = 'pending'
            AND id IN (${sql.join(
              removed.map((row) => sql`${row.id}::uuid`),
              sql`, `,
            )})
          RETURNING id
        `),
        z.object({ id: z.string() }),
      );
      return deleted.length;
    },
  };
  return service;
}

function entityLabel(entityType: AttachmentEntityType): string {
  return entityType === "issue" ? "Issue" : entityType === "doc" ? "Doc" : "Comment";
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
