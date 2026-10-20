import { and, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import { adrTitle, splitAdrTitle } from "@/lib/docs/adr";
import { type DocType, isDocType } from "@/lib/docs/constants";
import {
  type createAdrInput,
  type createDocInput,
  type moveDocInput,
  type saveDocInput,
  type updateDocMetaInput,
} from "@/lib/docs/schemas";
import { compareSiblings, siblingsOf } from "@/lib/docs/tree";
import { formatIssueKey, parseIssueKey } from "@/lib/issues/keys";
import { emptyDoc, extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import { docs, issues, projects, templates, users } from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { allInOrder } from "./parallel";
import {
  docRefs,
  jsonbOrNull,
  mentionSyncCtes,
  mentionSyncStatement,
  rowsOf,
  uuidOrNull,
} from "./sql";

export type CreateDocData = z.output<typeof createDocInput>;
export type CreateAdrData = z.output<typeof createAdrInput>;
export type SaveDocData = z.output<typeof saveDocInput>;
export type UpdateDocMetaData = z.output<typeof updateDocMetaInput>;
export type MoveDocData = z.output<typeof moveDocInput>;

/** §7.4: a save keeps a snapshot when the last one is older than this (or on "Save version"). */
export const SNAPSHOT_INTERVAL_MINUTES = 10;
/** Attempts when two "New ADR"s race for the same number (ADR-1). */
const ADR_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CreatedDoc {
  id: string;
  title: string;
  version: number;
}

/** The other side of a lost optimistic-lock race, so the editor can offer reload/keep/copy. */
export interface LatestDoc {
  version: number;
  title: string;
  content: RichTextDoc | null;
  updatedByName: string | null;
  updatedAt: Date;
}

export type SaveDocResult =
  | { status: "saved"; version: number; snapshotted: boolean }
  | { status: "conflict"; latest: LatestDoc };

export interface DocServiceOptions {
  /** Transactions of several statements (see `RunAtomic`). */
  runAtomic: RunAtomic;
  /** How the validation reads run; on Neon, reads started together share a round trip. */
  read?: Read;
  /** Test hook: runs between reading the next ADR number and the insert. */
  beforeAdrInsert?: () => Promise<void>;
}

/**
 * Docs and ADRs (DOC-1…5, DOC-9, ADR-1/2/4). Writes are single statements or `RunAtomic`
 * batches (see `AppDatabase`). Content saves use optimistic locking (§7.4, §9.4); metadata
 * (type, status, owner, ADR status) is last-write-wins per field.
 *
 * Tree changes (move, delete) take a per-project advisory lock first, in the same
 * transaction, so two concurrent moves cannot each pass the cycle check against a tree the
 * other is about to change (A under B while B goes under A).
 */
export function createDocService(db: AppDatabase, options: DocServiceOptions) {
  const read = options.read ?? directRead;

  async function projectByKey(key: string) {
    const [project] = await read(
      db
        .select({ id: projects.id, key: projects.key })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1),
    );
    if (!project) throw notFound(`Project ${key}`);
    return project;
  }

  async function liveDoc(docId: string) {
    const [doc] = await read(
      db
        .select({
          id: docs.id,
          projectId: docs.projectId,
          parentId: docs.parentId,
          type: docs.type,
          position: docs.position,
          adrNumber: docs.adrNumber,
        })
        .from(docs)
        .where(and(eq(docs.id, docId), isNull(docs.deletedAt)))
        .limit(1),
    );
    if (!doc) throw notFound("Doc");
    return doc;
  }

  async function allProjectKeys(): Promise<string[]> {
    const rows = await read(db.select({ key: projects.key }).from(projects));
    return rows.map((row) => row.key);
  }

  /** Every live doc of a project, as tree nodes. */
  async function treeOf(projectId: string) {
    return db
      .select({ id: docs.id, parentId: docs.parentId, position: docs.position })
      .from(docs)
      .where(and(eq(docs.projectId, projectId), isNull(docs.deletedAt)));
  }

  async function checkParent(projectId: string, parentId: string | null) {
    if (!parentId) return;
    const [row] = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(eq(docs.id, parentId), eq(docs.projectId, projectId), isNull(docs.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Parent doc");
  }

  async function checkUser(userId: string | null) {
    if (!userId) return;
    const [row] = await read(
      db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1),
    );
    if (!row) throw notFound("User");
  }

  /** A key after the last live child of `parentId` (new docs go to the end). */
  async function endPosition(projectId: string, parentId: string | null): Promise<string> {
    const [last] = await db
      .select({ position: docs.position })
      .from(docs)
      .where(
        and(
          eq(docs.projectId, projectId),
          parentId ? eq(docs.parentId, parentId) : isNull(docs.parentId),
          isNull(docs.deletedAt),
        ),
      )
      .orderBy(desc(docs.position), desc(docs.id))
      .limit(1);
    return generateKeyBetween(last?.position ?? null, null);
  }

  async function docTemplate(templateId: string) {
    const [row] = await db
      .select({ id: templates.id, subtype: templates.subtype, content: templates.content })
      .from(templates)
      .where(and(eq(templates.id, templateId), eq(templates.kind, "doc")))
      .limit(1);
    if (!row) throw notFound("Template");
    return row;
  }

  /** The built-in ADR template (the seed creates it); an empty doc if it is missing. */
  async function adrTemplate() {
    const [row] = await db
      .select({ id: templates.id, content: templates.content })
      .from(templates)
      .where(
        and(eq(templates.kind, "doc"), eq(templates.subtype, "adr"), eq(templates.builtIn, true)),
      )
      .limit(1);
    return row ?? null;
  }

  /** Per-project lock for tree changes, held until the transaction ends. */
  const treeLock = (projectId: string) =>
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hq.docs_tree:${projectId}`}, 0))`;

  /**
   * Inserts a doc, its first version snapshot (so history starts at v1), a `created` activity
   * row and its mention links, in ONE statement. The parent is re-checked at write time.
   */
  async function insertDoc(
    actorId: string,
    values: {
      projectId: string;
      parentId: string | null;
      type: DocType;
      title: string;
      content: RichTextDoc;
      templateId: string | null;
      adrNumber?: number;
    },
  ): Promise<CreatedDoc> {
    const id = crypto.randomUUID();
    const position = await endPosition(values.projectId, values.parentId);
    const refs = docRefs(values.content, await allProjectKeys());
    const isAdr = values.adrNumber !== undefined;
    const parentGate = values.parentId
      ? sql`EXISTS (SELECT 1 FROM docs p WHERE p.id = ${values.parentId}::uuid
          AND p.project_id = ${values.projectId}::uuid AND p.deleted_at IS NULL)`
      : sql`TRUE`;
    const result = await db.execute(sql`
      WITH inserted AS (
        INSERT INTO docs (id, project_id, parent_id, type, title, content, content_text,
          owner_id, updated_by, position, template_id, adr_number, adr_status)
        SELECT ${id}::uuid, ${values.projectId}::uuid, ${uuidOrNull(values.parentId)},
          ${values.type}::doc_type, ${values.title}, ${jsonbOrNull(values.content)},
          ${extractPlainText(values.content)}, ${actorId}::uuid, ${actorId}::uuid, ${position},
          ${uuidOrNull(values.templateId)}, ${isAdr ? values.adrNumber : null}::int,
          ${isAdr ? "proposed" : null}::adr_status
        WHERE ${parentGate}
        RETURNING id, version, title, content
      ),
      first_version AS (
        INSERT INTO doc_versions (doc_id, version, title, content, author_id)
        SELECT id, version, title, content, ${actorId}::uuid FROM inserted
      ),
      created_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
        SELECT 'doc', id, ${actorId}::uuid, 'created', ${values.type} FROM inserted
      ),
      ${mentionSyncCtes({
        // Safe inline: the doc is new, so no other request can be syncing it.
        fromType: "doc",
        fromId: id,
        refs,
        actorId,
        gate: sql`EXISTS (SELECT 1 FROM inserted)`,
      })}
      SELECT id::text, version, title FROM inserted
    `);
    const [row] = rowsOf(
      result,
      z.object({ id: z.string(), version: z.number(), title: z.string() }),
    );
    if (!row) throw notFound("Parent doc");
    return row;
  }

  /**
   * A key for `index` among `siblings` (already without the moving doc). Equal neighbouring
   * keys (possible after two simultaneous creates; positions are not unique) leave no gap,
   * so the caller respaces that sibling group first.
   */
  function keyAt(siblings: { position: string }[], index: number): string | null {
    const before = siblings[index - 1]?.position ?? null;
    const after = siblings[index]?.position ?? null;
    if (before !== null && after !== null && before >= after) return null;
    return generateKeyBetween(before, after);
  }

  return {
    /** DOC-2/DOC-5. With a template, the content is copied and the type comes from it. */
    async createDoc(actorId: string, input: CreateDocData): Promise<CreatedDoc> {
      const project = await projectByKey(input.projectKey);
      const parentId = input.parentId ?? null;
      await checkParent(project.id, parentId);
      let type: DocType = input.type;
      let content: RichTextDoc = emptyDoc();
      let templateId: string | null = null;
      if (input.templateId) {
        const template = await docTemplate(input.templateId);
        // The ADR template is used through "New ADR" (numbering); elsewhere it makes a page.
        type =
          isDocType(template.subtype) && template.subtype !== "adr" ? template.subtype : "page";
        content = template.content;
        templateId = template.id;
      }
      return insertDoc(actorId, {
        projectId: project.id,
        parentId,
        type,
        title: input.title,
        content,
        templateId,
      });
    },

    /**
     * ADR-1. Number = highest in the project + 1 (deleted ADRs included: numbers are never
     * reused). Two concurrent creators can read the same maximum; the unique
     * (project_id, adr_number) index rejects the second, which re-reads and retries. The new
     * ADR goes next to the highest-numbered live ADR (e.g. under "Decisions" after the import).
     */
    async createAdr(
      actorId: string,
      input: CreateAdrData,
    ): Promise<CreatedDoc & { number: number }> {
      const project = await projectByKey(input.projectKey);
      const template = await adrTemplate();
      const [latest] = await db
        .select({ parentId: docs.parentId })
        .from(docs)
        .where(and(eq(docs.projectId, project.id), eq(docs.type, "adr"), isNull(docs.deletedAt)))
        .orderBy(desc(docs.adrNumber))
        .limit(1);
      const parentId = latest?.parentId ?? null;

      for (let attempt = 1; ; attempt += 1) {
        const [max] = await db
          .select({ max: sql<number | null>`max(${docs.adrNumber})` })
          .from(docs)
          .where(eq(docs.projectId, project.id));
        const number = (max?.max ?? 0) + 1;
        await options.beforeAdrInsert?.();
        try {
          const created = await insertDoc(actorId, {
            projectId: project.id,
            parentId,
            type: "adr",
            title: adrTitle(number, input.title),
            content: template?.content ?? emptyDoc(),
            templateId: template?.id ?? null,
            adrNumber: number,
          });
          return { ...created, number };
        } catch (error) {
          const info = pgErrorInfo(error);
          const taken =
            info?.code === UNIQUE_VIOLATION && info.constraint === "docs_project_adr_number_unique";
          if (!taken) throw error;
          if (attempt >= ADR_ATTEMPTS) throw conflict("Too many concurrent ADRs; try again");
          // Jitter so racing creators do not collide again on the next attempt.
          await sleep(Math.random() * 20 * attempt);
        }
      }
    },

    /**
     * §7.4 optimistic locking: `UPDATE … WHERE id AND version = base` bumps the version; a
     * snapshot is kept if the last one is over 10 minutes old (or on "Save version"). If no
     * row matched, someone saved first: return their version so the editor can show the
     * conflict banner. "Keep mine" calls this again with that version as the base, so it
     * still loses (and reports) if a third save landed meanwhile.
     *
     * The mention sync is the second statement of the same transaction. Its gate checks
     * `xmin` (the id of the transaction that last wrote the row): only if THIS transaction
     * wrote the doc does it resync, so a lost save never replaces the winner's links, and the
     * row lock taken by the update keeps other savers out until the sync commits.
     */
    async saveDoc(actorId: string, input: SaveDocData): Promise<SaveDocResult> {
      // Both reads in one round trip (autosave runs every few seconds while typing).
      const [doc, projectKeys] = await allInOrder([liveDoc(input.docId), allProjectKeys()]);
      const text = extractPlainText(input.content);
      const refs = docRefs(input.content, projectKeys);
      // ADR titles always keep their own "NNNN. " prefix (ADR-1), whatever the client sent.
      const title =
        input.title !== undefined && doc.type === "adr" && doc.adrNumber !== null
          ? adrTitle(doc.adrNumber, splitAdrTitle(input.title)?.title || input.title)
          : input.title;
      const write = sql`
        WITH updated AS (
          UPDATE docs SET content = ${jsonbOrNull(input.content)}, content_text = ${text},
            title = COALESCE(${title ?? null}::text, title), version = version + 1,
            updated_by = ${actorId}::uuid, updated_at = now()
          WHERE id = ${doc.id}::uuid AND version = ${input.baseVersion}::int
            AND deleted_at IS NULL
          RETURNING id, version, title, content
        ),
        last_snapshot AS (
          SELECT max(created_at) AS at FROM doc_versions WHERE doc_id = ${doc.id}::uuid
        ),
        snapshot AS (
          INSERT INTO doc_versions (doc_id, version, title, content, author_id)
          SELECT u.id, u.version, u.title, u.content, ${actorId}::uuid
          FROM updated u, last_snapshot l
          WHERE ${input.snapshot}::boolean OR l.at IS NULL
            OR l.at < now() - make_interval(mins => ${SNAPSHOT_INTERVAL_MINUTES}::int)
          RETURNING version
        )
        SELECT u.version, EXISTS (SELECT 1 FROM snapshot) AS snapshotted FROM updated u
      `;
      const sync = mentionSyncStatement({
        fromType: "doc",
        fromId: doc.id,
        refs,
        actorId,
        gate: sql`EXISTS (SELECT 1 FROM docs WHERE id = ${doc.id}::uuid
          AND xmin = pg_current_xact_id()::xid)`,
      });
      const [result] = await options.runAtomic([write, sync]);
      const [row] = rowsOf(result, z.object({ version: z.number(), snapshotted: z.boolean() }));
      if (row) return { status: "saved", version: row.version, snapshotted: row.snapshotted };

      const [latest] = await db
        .select({
          version: docs.version,
          title: docs.title,
          content: docs.content,
          updatedByName: users.name,
          updatedAt: docs.updatedAt,
          deletedAt: docs.deletedAt,
        })
        .from(docs)
        .leftJoin(users, eq(users.id, docs.updatedBy))
        .where(eq(docs.id, doc.id))
        .limit(1);
      if (!latest || latest.deletedAt) throw notFound("Doc");
      return {
        status: "conflict",
        latest: {
          version: latest.version,
          title: latest.title,
          content: latest.content,
          updatedByName: latest.updatedByName,
          updatedAt: latest.updatedAt,
        },
      };
    },

    /**
     * Rename from the tree. Bumps the version (the title is part of what the editor saves),
     * so an editor open on the old title gets the conflict banner instead of undoing it.
     */
    async renameDoc(actorId: string, input: { docId: string; title: string }) {
      const doc = await liveDoc(input.docId);
      const result = await db.execute(sql`
        UPDATE docs SET title = ${input.title}, version = version + 1,
          updated_by = ${actorId}::uuid, updated_at = now()
        WHERE id = ${doc.id}::uuid AND deleted_at IS NULL AND type <> 'adr'
        RETURNING version
      `);
      const [row] = rowsOf(result, z.object({ version: z.number() }));
      if (!row) {
        throw doc.type === "adr"
          ? invalid("Rename an ADR in its editor; its number prefix must stay")
          : notFound("Doc");
      }
      return { version: row.version };
    },

    /** DOC-3/DOC-4 and ADR-2 fields. */
    async updateMeta(actorId: string, input: UpdateDocMetaData): Promise<void> {
      // The doc and the new owner are read together; a missing doc is reported first.
      const [doc] = await allInOrder([
        liveDoc(input.docId),
        input.field === "owner" ? checkUser(input.value) : Promise.resolve(),
      ]);
      let set: SQL;
      let where: SQL = sql``;
      switch (input.field) {
        case "type":
          // ADRs carry a number; turning docs into ADRs (or back) would break the ADR log.
          if (doc.type === "adr") throw invalid("An ADR cannot change its type");
          set = sql`type = ${input.value}::doc_type`;
          break;
        case "status":
          set = sql`status = ${input.value}::doc_status`;
          break;
        case "owner":
          set = sql`owner_id = ${uuidOrNull(input.value)}`;
          break;
        case "adrStatus": {
          if (doc.type !== "adr") throw invalid("Only ADRs have an ADR status");
          const target = input.value === "superseded" ? (input.supersededBy ?? null) : null;
          if (input.value === "superseded") {
            if (!target) throw invalid("Choose the ADR that supersedes this one");
            if (target === doc.id) throw invalid("An ADR cannot supersede itself");
            // Re-checked at write time: the target must be a live ADR of the same project.
            where = sql`AND EXISTS (SELECT 1 FROM docs t WHERE t.id = ${target}::uuid
              AND t.project_id = docs.project_id AND t.type = 'adr' AND t.deleted_at IS NULL)`;
          }
          set = sql`adr_status = ${input.value}::adr_status,
            adr_superseded_by = ${uuidOrNull(target)}`;
          break;
        }
      }
      const result = await db.execute(sql`
        UPDATE docs SET ${set}, updated_by = ${actorId}::uuid, updated_at = now()
        WHERE id = ${doc.id}::uuid AND deleted_at IS NULL ${where}
        RETURNING id
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        throw notFound(input.field === "adrStatus" ? "Doc or superseding ADR" : "Doc");
      }
    },

    /**
     * DOC-2 move: new parent and index among its other children. The new position is a key
     * between the new neighbours; only this doc's row changes (unless a tie forces a respace
     * of that sibling group). The cycle check runs in SQL after the tree lock: the new parent
     * must not be the doc itself or any doc below it.
     */
    async moveDoc(actorId: string, input: MoveDocData): Promise<void> {
      const doc = await liveDoc(input.docId);
      if (input.parentId === doc.id) throw invalid("A doc cannot be moved under itself");
      await checkParent(doc.projectId, input.parentId);
      const tree = await treeOf(doc.projectId);
      const siblings = siblingsOf(tree, input.parentId, doc.id);
      const index = Math.min(input.index, siblings.length);
      let position = keyAt(siblings, index);
      const parentId = input.parentId;
      // Shared by the respace and the move, so a refused move changes nothing at all.
      const below = sql`below AS (
          SELECT id FROM docs WHERE parent_id = ${doc.id}::uuid
          UNION
          SELECT d.id FROM docs d JOIN below b ON d.parent_id = b.id
        )`;
      const allowed = sql`EXISTS (SELECT 1 FROM docs m
          WHERE m.id = ${doc.id}::uuid AND m.deleted_at IS NULL)
        AND ${parentId}::uuid IS DISTINCT FROM ${doc.id}::uuid
        AND (${parentId}::uuid IS NULL OR ${parentId}::uuid NOT IN (SELECT id FROM below))
        AND (${parentId}::uuid IS NULL OR EXISTS (SELECT 1 FROM docs p
          WHERE p.id = ${parentId}::uuid AND p.project_id = ${doc.projectId}::uuid
            AND p.deleted_at IS NULL))`;
      const statements: SQL[] = [];
      if (position === null) {
        // Tied keys around the gap: give the whole group fresh, distinct keys first.
        const keys = generateNKeysBetween(null, null, siblings.length);
        const respaced = siblings.map((sibling, i) => ({
          id: sibling.id,
          position: keys[i] ?? "",
        }));
        statements.push(sql`
          WITH RECURSIVE ${below}
          UPDATE docs SET position = r.position
          FROM jsonb_to_recordset(${JSON.stringify(respaced)}::jsonb) AS r(id uuid, position text)
          WHERE docs.id = r.id AND ${allowed}
        `);
        position = keyAt(respaced, index) ?? generateKeyBetween(null, null);
      }
      const move = sql`
        WITH RECURSIVE ${below},
        moved AS (
          UPDATE docs SET parent_id = ${uuidOrNull(parentId)}, position = ${position},
            updated_at = now()
          WHERE id = ${doc.id}::uuid AND ${allowed}
          RETURNING id
        ),
        move_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'doc', id, ${actorId}::uuid, 'moved', 'parent', ${doc.parentId}::text,
            ${parentId}::text
          FROM moved
          WHERE ${doc.parentId}::uuid IS DISTINCT FROM ${parentId}::uuid
        )
        SELECT id::text FROM moved
      `;
      const results = await options.runAtomic([treeLock(doc.projectId), ...statements, move]);
      if (rowsOf(results.at(-1), z.object({ id: z.string() })).length === 0) {
        // Nothing moved: the doc or the new parent went away meanwhile, or (the usual case)
        // the new parent is below the doc. Re-read to tell which.
        await liveDoc(doc.id);
        await checkParent(doc.projectId, parentId);
        throw invalid("A doc cannot be moved under one of its own sub-pages");
      }
    },

    /**
     * Soft delete. Its children move up to its parent, at its place in the order, so nothing
     * disappears with it (DOC-2). One transaction after the tree lock: children created or
     * moved in meanwhile are lifted too (they keep their own key if they had none planned).
     * The planned keys come from a read before the lock, so the delete applies only if the
     * doc is still where that read saw it; if it moved meanwhile, plan again.
     */
    async deleteDoc(actorId: string, docId: string): Promise<void> {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const doc = await liveDoc(docId);
        const tree = await treeOf(doc.projectId);
        const children = tree.filter((node) => node.parentId === doc.id).sort(compareSiblings);
        const siblings = siblingsOf(tree, doc.parentId, doc.id);
        const next = siblings.find((sibling) => compareSiblings(sibling, doc) > 0);
        // A tied neighbour leaves no gap; the children then go right after the tie.
        const nextPosition = next && next.position > doc.position ? next.position : null;
        const keys = generateNKeysBetween(doc.position, nextPosition, children.length);
        const planned = children.map((child, i) => ({ id: child.id, position: keys[i] ?? "" }));
        const results = await options.runAtomic([
          treeLock(doc.projectId),
          sql`
            WITH deleted AS (
              UPDATE docs SET deleted_at = now(), updated_by = ${actorId}::uuid,
                updated_at = now()
              WHERE id = ${doc.id}::uuid AND deleted_at IS NULL
                AND parent_id IS NOT DISTINCT FROM ${uuidOrNull(doc.parentId)}
                AND position = ${doc.position}
              RETURNING id, parent_id
            ),
            plan AS (
              SELECT * FROM jsonb_to_recordset(${JSON.stringify(planned)}::jsonb)
                AS r(id uuid, position text)
            ),
            lifted AS (
              UPDATE docs SET parent_id = deleted.parent_id,
                position = COALESCE((SELECT plan.position FROM plan WHERE plan.id = docs.id),
                  docs.position),
                updated_at = now()
              FROM deleted
              WHERE docs.parent_id = deleted.id AND docs.deleted_at IS NULL
              RETURNING docs.id
            ),
            delete_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action)
              SELECT 'doc', id, ${actorId}::uuid, 'deleted' FROM deleted
            )
            SELECT (SELECT count(*)::int FROM deleted) AS deleted,
              (SELECT count(*)::int FROM lifted) AS lifted
          `,
        ]);
        const [row] = rowsOf(results.at(-1), z.object({ deleted: z.number(), lifted: z.number() }));
        if (row && row.deleted > 0) return;
      }
      // Gone (liveDoc throws not found), or it keeps moving: let the person retry.
      await liveDoc(docId);
      throw conflict("The page is being moved right now; try again");
    },

    /** DOC-9 manual "Link issue" by key (stored doc → issue, origin `manual`). */
    async linkIssue(actorId: string, input: { docId: string; issueKey: string }) {
      const doc = await liveDoc(input.docId);
      const ref = parseIssueKey(input.issueKey);
      if (!ref) throw invalid("Enter an issue key such as STK-12");
      const [issue] = await db
        .select({ id: issues.id })
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
      if (!issue) throw notFound(formatIssueKey(ref.projectKey, ref.number));
      const result = await db.execute(sql`
        INSERT INTO entity_links (from_type, from_id, to_type, to_id, origin, created_by)
        VALUES ('doc', ${doc.id}::uuid, 'issue', ${issue.id}::uuid, 'manual', ${actorId}::uuid)
        ON CONFLICT DO NOTHING
        RETURNING id::text
      `);
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw conflict("That issue is already linked");
      return { linkId: row.id };
    },

    /** Removes a manual link. Mention links follow the text, so they are removed by editing. */
    async unlinkIssue(_actorId: string, input: { docId: string; linkId: string }) {
      const result = await db.execute(sql`
        DELETE FROM entity_links
        WHERE id = ${input.linkId}::uuid AND origin = 'manual' AND from_type = 'doc'
          AND from_id = ${input.docId}::uuid
        RETURNING id
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Link");
    },
  };
}

export type DocService = ReturnType<typeof createDocService>;
