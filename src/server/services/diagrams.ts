import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import {
  type DiagramKind,
  DIAGRAM_SNAPSHOT_INTERVAL_MINUTES,
  DIAGRAM_VERSION_CAP,
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_MAX_BYTES,
} from "@/lib/diagrams/constants";
import { type DiagramScene, emptyScene, parseScene, sceneText } from "@/lib/diagrams/scene";
import {
  type createDiagramInput,
  type linkDiagramInput,
  type moveDiagramInput,
  type restoreDiagramVersionInput,
  type saveDiagramInput,
  type thumbnailUploadInput,
} from "@/lib/diagrams/schemas";
import { formatIssueKey, parseIssueKey } from "@/lib/issues/keys";
import { diagramKindOfTemplate } from "@/lib/templates/diagram-templates";
import { directRead, type Read } from "@/server/db/read-batch";
import { diagrams, docs, issues, projects, users } from "@/server/db/schema";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";
import { diagramThumbnailKey } from "@/server/storage/keys";
import { type Storage } from "@/server/storage/storage";

import { conflict, invalid, notFound } from "./errors";
import { jsonbOrNull, rowsOf } from "./sql";

export type CreateDiagramData = z.output<typeof createDiagramInput>;
export type SaveDiagramData = z.output<typeof saveDiagramInput>;
export type MoveDiagramData = z.output<typeof moveDiagramInput>;
export type RestoreDiagramData = z.output<typeof restoreDiagramVersionInput>;
export type LinkDiagramData = z.output<typeof linkDiagramInput>;
export type ThumbnailUploadData = z.output<typeof thumbnailUploadInput>;

export interface CreatedDiagram {
  id: string;
  kind: DiagramKind;
  title: string;
  version: number;
}

/** The other side of a lost optimistic-lock race (§7.4), for the conflict banner. */
export interface LatestDiagram {
  version: number;
  title: string;
  scene: DiagramScene;
  updatedByName: string | null;
  updatedAt: Date;
}

export type SaveDiagramResult =
  | { status: "saved"; version: number; snapshotted: boolean }
  | { status: "conflict"; latest: LatestDiagram };

/** DGM-5: either a presigned PUT, or "storage isn't configured" (the client skips quietly). */
export type ThumbnailUpload =
  { status: "skipped" } | { status: "upload"; url: string; headers: { "Content-Type": string } };

export interface DiagramServiceOptions {
  runAtomic: RunAtomic;
  read?: Read;
  /** The R2 storage (`@/server/storage`); only these calls are used. */
  storage: Pick<Storage, "storageConfigured" | "presignUpload" | "headObject">;
}

const versionRow = z.object({ version: z.number(), snapshotted: z.boolean() });

/**
 * Diagrams (DGM-1…7). Same mechanism as docs (§7.4, DGM-4): a scene save is
 * `UPDATE … WHERE version = base` in ONE statement that also keeps a snapshot when the last
 * one is over 10 minutes old (or on "Save version") and prunes history to the newest 50
 * (§7.3). Losing a race returns the winner's copy; nothing is ever overwritten blindly.
 */
export function createDiagramService(db: AppDatabase, options: DiagramServiceOptions) {
  const read = options.read ?? directRead;
  const { storage } = options;

  async function projectByKey(key: string) {
    const [project] = await read(
      db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1),
    );
    if (!project) throw notFound(`Project ${key}`);
    return project;
  }

  async function liveDiagram(diagramId: string) {
    const [row] = await read(
      db
        .select({
          id: diagrams.id,
          projectId: diagrams.projectId,
          kind: diagrams.kind,
          title: diagrams.title,
          version: diagrams.version,
          position: diagrams.position,
        })
        .from(diagrams)
        .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt)))
        .limit(1),
    );
    if (!row) throw notFound("Diagram");
    return row;
  }

  async function diagramTemplate(templateId: string) {
    const result = await read(
      db.execute(sql`
        SELECT id::text, subtype, content FROM templates
        WHERE id = ${templateId}::uuid AND kind = 'diagram'
      `),
    );
    const [row] = rowsOf(
      result,
      z.object({ id: z.string(), subtype: z.string(), content: z.unknown() }),
    );
    if (!row) throw notFound("Template");
    const kind = diagramKindOfTemplate(row.subtype);
    if (!kind) throw invalid("That template is not a diagram template");
    const scene = parseScene(kind, row.content);
    if (!scene.ok) throw invalid(`The template is broken: ${scene.error}`);
    return { id: row.id, kind, scene: scene.scene };
  }

  /** Every live diagram of the project in list order (for keys between neighbours). */
  async function listOrder(projectId: string) {
    return db
      .select({ id: diagrams.id, position: diagrams.position })
      .from(diagrams)
      .where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt)))
      .orderBy(asc(diagrams.position), asc(diagrams.id));
  }

  async function latestOf(diagramId: string): Promise<LatestDiagram> {
    const [latest] = await db
      .select({
        kind: diagrams.kind,
        version: diagrams.version,
        title: diagrams.title,
        scene: diagrams.scene,
        updatedByName: users.name,
        updatedAt: diagrams.updatedAt,
        deletedAt: diagrams.deletedAt,
      })
      .from(diagrams)
      .leftJoin(users, eq(users.id, diagrams.updatedBy))
      .where(eq(diagrams.id, diagramId))
      .limit(1);
    if (!latest || latest.deletedAt) throw notFound("Diagram");
    const parsed = parseScene(latest.kind, latest.scene);
    return {
      version: latest.version,
      title: latest.title,
      scene: parsed.ok ? parsed.scene : emptyScene(latest.kind),
      updatedByName: latest.updatedByName,
      updatedAt: latest.updatedAt,
    };
  }

  /**
   * The locked write shared by save and restore: bump the version only if it is still
   * `baseVersion`, keep a snapshot when due (or `forceSnapshot`), prune the history to the
   * newest `DIAGRAM_VERSION_CAP`, and log a title change and/or `action` in the same
   * statement. The `before` CTE reads the row as of the statement's snapshot: when the
   * update matches, nobody changed it since `baseVersion`, so that is the old title.
   */
  async function lockedWrite(
    actorId: string,
    input: {
      diagramId: string;
      baseVersion: number;
      scene: DiagramScene;
      text: string;
      title: string | undefined;
      forceSnapshot: boolean;
      /** An extra activity row, e.g. `restored` (from = restored version). */
      action?: { name: string; fromValue: string };
    },
  ): Promise<SaveDiagramResult> {
    const { diagramId } = input;
    const result = await db.execute(sql`
      WITH before AS (
        SELECT title FROM diagrams WHERE id = ${diagramId}::uuid
      ),
      updated AS (
        UPDATE diagrams SET scene = ${jsonbOrNull(input.scene)}, scene_text = ${input.text},
          title = COALESCE(${input.title ?? null}::text, title), version = version + 1,
          updated_by = ${actorId}::uuid, updated_at = now()
        WHERE id = ${diagramId}::uuid AND version = ${input.baseVersion}::int
          AND deleted_at IS NULL
        RETURNING id, version, title, scene
      ),
      last_snapshot AS (
        SELECT max(created_at) AS at FROM diagram_versions WHERE diagram_id = ${diagramId}::uuid
      ),
      snapshot AS (
        INSERT INTO diagram_versions (diagram_id, version, title, scene, author_id)
        SELECT u.id, u.version, u.title, u.scene, ${actorId}::uuid
        FROM updated u, last_snapshot l
        WHERE ${input.forceSnapshot}::boolean OR l.at IS NULL
          OR l.at < now() - make_interval(mins => ${DIAGRAM_SNAPSHOT_INTERVAL_MINUTES}::int)
        RETURNING version
      ),
      pruned AS (
        -- Sees the history before this statement's insert: keep the newest cap - 1 of
        -- those, plus the new snapshot.
        DELETE FROM diagram_versions
        WHERE diagram_id = ${diagramId}::uuid AND EXISTS (SELECT 1 FROM snapshot)
          AND version NOT IN (
            SELECT version FROM diagram_versions WHERE diagram_id = ${diagramId}::uuid
            ORDER BY version DESC LIMIT ${DIAGRAM_VERSION_CAP - 1}::int
          )
      ),
      title_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
          to_value)
        SELECT 'diagram', u.id, ${actorId}::uuid, 'updated', 'title', b.title, u.title
        FROM updated u, before b
        WHERE u.title IS DISTINCT FROM b.title
      ),
      extra_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, from_value, to_value)
        SELECT 'diagram', u.id, ${actorId}::uuid, ${input.action?.name ?? null}::text,
          ${input.action?.fromValue ?? null}::text, u.version::text
        FROM updated u
        WHERE ${input.action?.name ?? null}::text IS NOT NULL
      )
      SELECT u.version, EXISTS (SELECT 1 FROM snapshot) AS snapshotted FROM updated u
    `);
    const [row] = rowsOf(result, versionRow);
    if (row) return { status: "saved", version: row.version, snapshotted: row.snapshotted };
    return { status: "conflict", latest: await latestOf(diagramId) };
  }

  /** A key for `index` among `others` (already without the moving diagram); null on a tie. */
  function keyAt(others: { position: string }[], index: number): string | null {
    const before = others[index - 1]?.position ?? null;
    const after = others[index]?.position ?? null;
    if (before !== null && after !== null && before >= after) return null;
    return generateKeyBetween(before, after);
  }

  async function issueByKey(issueKey: string) {
    const ref = parseIssueKey(issueKey);
    if (!ref) throw invalid("Enter an issue key such as STK-12");
    const [issue] = await read(
      db
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
        .limit(1),
    );
    if (!issue) throw notFound(formatIssueKey(ref.projectKey, ref.number));
    return issue;
  }

  async function liveDoc(docId: string) {
    const [doc] = await read(
      db
        .select({ id: docs.id })
        .from(docs)
        .where(and(eq(docs.id, docId), isNull(docs.deletedAt)))
        .limit(1),
    );
    if (!doc) throw notFound("Doc");
    return doc;
  }

  return {
    /** DGM-1/2 "New whiteboard" / "New flow"; DGM-3 "New from template" (kind from it). */
    async createDiagram(actorId: string, input: CreateDiagramData): Promise<CreatedDiagram> {
      const [project, template] = await Promise.all([
        projectByKey(input.projectKey),
        input.templateId ? diagramTemplate(input.templateId) : Promise.resolve(null),
      ]);
      const kind = template?.kind ?? input.kind;
      const scene = template?.scene ?? emptyScene(kind);
      const order = await listOrder(project.id);
      const position = generateKeyBetween(order.at(-1)?.position ?? null, null);
      const id = crypto.randomUUID();
      const result = await db.execute(sql`
        WITH inserted AS (
          INSERT INTO diagrams (id, project_id, kind, title, scene, scene_text, owner_id,
            updated_by, template_id, position)
          VALUES (${id}::uuid, ${project.id}::uuid, ${kind}::diagram_kind, ${input.title},
            ${jsonbOrNull(scene)}, ${sceneText(kind, scene)}, ${actorId}::uuid,
            ${actorId}::uuid, ${template?.id ?? null}::uuid, ${position})
          RETURNING id, version, title, scene
        ),
        first_version AS (
          INSERT INTO diagram_versions (diagram_id, version, title, scene, author_id)
          SELECT id, version, title, scene, ${actorId}::uuid FROM inserted
        ),
        created_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
          SELECT 'diagram', id, ${actorId}::uuid, 'created', ${kind} FROM inserted
        )
        SELECT id::text, version, title FROM inserted
      `);
      const [row] = rowsOf(
        result,
        z.object({ id: z.string(), version: z.number(), title: z.string() }),
      );
      if (!row) throw notFound("Diagram");
      return { ...row, kind };
    },

    /**
     * §7.4 autosave. The scene is validated for the stored kind (and the 1.5 MB limit,
     * `DIAGRAM_SCENE_INPUT_MAX_BYTES`); `scene_text` is derived here, never sent.
     */
    async saveDiagram(actorId: string, input: SaveDiagramData): Promise<SaveDiagramResult> {
      const diagram = await liveDiagram(input.diagramId);
      const scene = parseScene(diagram.kind, input.scene);
      if (!scene.ok) throw invalid(scene.error);
      return lockedWrite(actorId, {
        diagramId: diagram.id,
        baseVersion: input.baseVersion,
        scene: scene.scene,
        text: sceneText(diagram.kind, scene.scene),
        title: input.title,
        forceSnapshot: input.snapshot,
      });
    },

    /**
     * DGM-4 restore: a NEW version whose scene is the old one's (history is never
     * rewritten), always snapshotted, locked on the editor's version like a save.
     */
    async restoreVersion(actorId: string, input: RestoreDiagramData): Promise<SaveDiagramResult> {
      const diagram = await liveDiagram(input.diagramId);
      const result = await read(
        db.execute(sql`
          SELECT scene FROM diagram_versions
          WHERE diagram_id = ${diagram.id}::uuid AND version = ${input.version}::int
        `),
      );
      const [old] = rowsOf(result, z.object({ scene: z.unknown() }));
      if (!old) throw notFound(`Version ${input.version}`);
      const scene = parseScene(diagram.kind, old.scene);
      if (!scene.ok) throw invalid(`Version ${input.version} cannot be restored: ${scene.error}`);
      return lockedWrite(actorId, {
        diagramId: diagram.id,
        baseVersion: input.baseVersion,
        scene: scene.scene,
        text: sceneText(diagram.kind, scene.scene),
        title: undefined,
        forceSnapshot: true,
        action: { name: "restored", fromValue: String(input.version) },
      });
    },

    /**
     * Rename from the list. Bumps the version (the title is part of what the editor
     * saves), so an editor open on the old title gets the conflict banner.
     */
    async renameDiagram(actorId: string, input: { diagramId: string; title: string }) {
      const diagram = await liveDiagram(input.diagramId);
      // `old` locks the row first: after waiting for a concurrent save it sees that save's
      // title (all CTEs share the snapshot taken before the wait, a locking read does not),
      // so the activity row records what was actually replaced.
      const result = await db.execute(sql`
        WITH old AS (
          SELECT id, title FROM diagrams
          WHERE id = ${diagram.id}::uuid AND deleted_at IS NULL
          FOR UPDATE
        ),
        updated AS (
          UPDATE diagrams SET title = ${input.title}, version = diagrams.version + 1,
            updated_by = ${actorId}::uuid, updated_at = now()
          FROM old
          WHERE diagrams.id = old.id
          RETURNING diagrams.id, diagrams.version, diagrams.title, old.title AS from_title
        ),
        title_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'diagram', u.id, ${actorId}::uuid, 'updated', 'title', u.from_title, u.title
          FROM updated u
          WHERE u.title IS DISTINCT FROM u.from_title
        )
        SELECT version FROM updated
      `);
      const [row] = rowsOf(result, z.object({ version: z.number() }));
      if (!row) throw notFound("Diagram");
      return { version: row.version };
    },

    /** Soft delete (§9.3): the row and its thumbnail object stay, for the trash. */
    async deleteDiagram(actorId: string, diagramId: string): Promise<void> {
      const result = await db.execute(sql`
        WITH deleted AS (
          UPDATE diagrams SET deleted_at = now(), updated_by = ${actorId}::uuid,
            updated_at = now()
          WHERE id = ${diagramId}::uuid AND deleted_at IS NULL
          RETURNING id
        ),
        delete_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action)
          SELECT 'diagram', id, ${actorId}::uuid, 'deleted' FROM deleted
        )
        SELECT id::text FROM deleted
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Diagram");
    },

    /**
     * List order: a fractional key between the new neighbours, so only this row changes
     * (unless equal neighbouring keys leave no gap: then the project's list is respaced in
     * the same transaction first).
     */
    async moveDiagram(_actorId: string, input: MoveDiagramData): Promise<void> {
      const diagram = await liveDiagram(input.diagramId);
      const others = (await listOrder(diagram.projectId)).filter((row) => row.id !== diagram.id);
      const index = Math.min(input.index, others.length);
      let position = keyAt(others, index);
      let respace: SQL | null = null;
      if (position === null) {
        const keys = generateNKeysBetween(null, null, others.length);
        const respaced = others.map((row, i) => ({ id: row.id, position: keys[i] ?? "" }));
        respace = sql`
          UPDATE diagrams SET position = r.position
          FROM jsonb_to_recordset(${JSON.stringify(respaced)}::jsonb) AS r(id uuid, position text)
          WHERE diagrams.id = r.id
        `;
        position = keyAt(respaced, index) ?? generateKeyBetween(null, null);
      }
      // Ordering is not a content change: no version bump and no activity row.
      const move = sql`
        UPDATE diagrams SET position = ${position}
        WHERE id = ${diagram.id}::uuid AND deleted_at IS NULL
        RETURNING id::text
      `;
      const results = await options.runAtomic(respace ? [respace, move] : [move]);
      if (rowsOf(results.at(-1), z.object({ id: z.string() })).length === 0) {
        throw notFound("Diagram");
      }
    },

    /** "Linked" panel: a manual link diagram → issue (by key) or → doc. */
    async link(actorId: string, input: LinkDiagramData): Promise<{ linkId: string }> {
      const [diagram, target] = await Promise.all([
        liveDiagram(input.diagramId),
        input.target === "issue" ? issueByKey(input.issueKey) : liveDoc(input.docId),
      ]);
      const result = await db.execute(sql`
        INSERT INTO entity_links (from_type, from_id, to_type, to_id, origin, created_by)
        VALUES ('diagram', ${diagram.id}::uuid, ${input.target}::entity_type,
          ${target.id}::uuid, 'manual', ${actorId}::uuid)
        ON CONFLICT DO NOTHING
        RETURNING id::text
      `);
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw conflict(`That ${input.target} is already linked`);
      return { linkId: row.id };
    },

    async unlink(_actorId: string, input: { diagramId: string; linkId: string }) {
      const result = await db.execute(sql`
        DELETE FROM entity_links
        WHERE id = ${input.linkId}::uuid AND origin = 'manual' AND from_type = 'diagram'
          AND from_id = ${input.diagramId}::uuid
        RETURNING id
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Link");
    },

    /**
     * DGM-5 step 1: a presigned PUT for `thumbnails/diagrams/<id>.png`. The key is built
     * here from the (live) diagram's id, never sent by the client, and the storage module
     * refuses any other key layout (`isAppKey`). Without R2 the client skips quietly.
     */
    async requestThumbnailUpload(
      _actorId: string,
      input: ThumbnailUploadData,
    ): Promise<ThumbnailUpload> {
      if (!storage.storageConfigured()) return { status: "skipped" };
      const diagram = await liveDiagram(input.diagramId);
      const upload = await storage.presignUpload({
        key: diagramThumbnailKey(diagram.id),
        contentType: THUMBNAIL_CONTENT_TYPE,
        contentLength: input.sizeBytes,
      });
      return { status: "upload", url: upload.url, headers: upload.headers };
    },

    /**
     * DGM-5 step 2, after the browser's PUT: the object must exist, be a PNG and within the
     * size limit; then `thumbnail_key` is set (not a content change: no version bump).
     */
    async confirmThumbnail(
      _actorId: string,
      diagramId: string,
    ): Promise<{ status: "skipped" } | { status: "saved" }> {
      if (!storage.storageConfigured()) return { status: "skipped" };
      const diagram = await liveDiagram(diagramId);
      const key = diagramThumbnailKey(diagram.id);
      const head = await storage.headObject(key);
      if (!head) throw notFound("Thumbnail upload");
      if (head.contentType !== THUMBNAIL_CONTENT_TYPE || head.sizeBytes > THUMBNAIL_MAX_BYTES) {
        throw invalid("The thumbnail must be a PNG of at most 1 MB");
      }
      const result = await db.execute(sql`
        UPDATE diagrams SET thumbnail_key = ${key}
        WHERE id = ${diagram.id}::uuid AND deleted_at IS NULL
        RETURNING id::text
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Diagram");
      return { status: "saved" };
    },
  };
}

export type DiagramService = ReturnType<typeof createDiagramService>;
