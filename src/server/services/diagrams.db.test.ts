import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DIAGRAM_SCENE_INPUT_MAX_BYTES,
  DIAGRAM_VERSION_CAP,
  SCENE_TOO_LARGE_MESSAGE,
} from "@/lib/diagrams/constants";
import { type FlowScene, sceneByteSize, type WhiteboardScene } from "@/lib/diagrams/scene";
import { type RichTextDoc } from "@/lib/rich-text";
import { activity, diagrams, diagramVersions, templates } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createStorage, type StorageTransport } from "@/server/storage/storage";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createDiagramQueries } from "./diagram-queries";
import { createDiagramService, type SaveDiagramResult } from "./diagrams";
import { createDocService } from "./docs";
import { ServiceError } from "./errors";
import { createFileQueries } from "./files";
import { createIssueService } from "./issues";
import { createSearchService } from "./search";
import { projectIdByKey } from "./sql";

const flow = (...labels: string[]): FlowScene => ({
  nodes: labels.map((label, i) => ({
    id: `n${i}`,
    type: "service",
    position: { x: i * 200, y: 0 },
    data: { label },
  })),
  edges: labels.slice(1).map((_, i) => ({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}` })),
  viewport: { x: 0, y: 0, zoom: 1 },
});

const board = (text: string): WhiteboardScene => ({
  elements: [
    { id: "r", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
    { id: "t", type: "text", text, originalText: text },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
});

function expectSaved(result: SaveDiagramResult) {
  if (result.status !== "saved") throw new Error(`expected saved, got ${result.status}`);
  return result;
}

/** DGM-1…7 against real Postgres (HQ_DB_TESTS=1). */
describeDb("diagrams (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let other: string;
  const noStorage = createStorage(null);
  const service = (storage = noStorage) =>
    createDiagramService(db, { runAtomic: transactionRunner(db), storage });
  const queries = () => createDiagramQueries(db);

  const create = (title: string, kind: "whiteboard" | "flow" = "flow", templateId?: string) =>
    service().createDiagram(actor, { projectKey: "STK", title, kind, templateId });
  const save = (
    diagramId: string,
    baseVersion: number,
    scene: unknown,
    extra: { title?: string; snapshot?: boolean; by?: string } = {},
  ) =>
    service().saveDiagram(extra.by ?? actor, {
      diagramId,
      baseVersion,
      scene,
      title: extra.title,
      snapshot: extra.snapshot ?? false,
    });
  const versionsOf = async (diagramId: string) =>
    (
      await db
        .select({ version: diagramVersions.version })
        .from(diagramVersions)
        .where(eq(diagramVersions.diagramId, diagramId))
        .orderBy(asc(diagramVersions.version))
    ).map((row) => row.version);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    other = await createTestUser(db, "Rita Rival");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("creates blank diagrams of each kind with v1 in the history and a created activity", async () => {
    const created = await create("Blank flow");
    expect(created).toMatchObject({ kind: "flow", title: "Blank flow", version: 1 });
    const wb = await create("Blank board", "whiteboard");
    const detail = await queries().getDiagram(projectIdByKey("STK"), wb.id);
    expect(detail).toMatchObject({
      kind: "whiteboard",
      scene: { elements: [], appState: {} },
      ownerName: "Ada Actor",
      hasThumbnail: false,
    });
    expect(await versionsOf(created.id)).toEqual([1]);
    const [row] = await db
      .select({ action: activity.action, to: activity.toValue })
      .from(activity)
      .where(and(eq(activity.entityType, "diagram"), eq(activity.entityId, created.id)));
    expect(row).toEqual({ action: "created", to: "flow" });
  });

  it("creates from a template: its kind, scene and scene_text (DGM-3)", async () => {
    const [template] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.kind, "diagram"), eq(templates.subtype, "flow:outbox")));
    if (!template) throw new Error("seed has no outbox template");
    const created = await create("Email outbox flow", "whiteboard", template.id);
    expect(created.kind).toBe("flow");
    const [row] = await db
      .select({ text: diagrams.sceneText, templateId: diagrams.templateId })
      .from(diagrams)
      .where(eq(diagrams.id, created.id));
    expect(row?.templateId).toBe(template.id);
    expect(row?.text).toContain("Scheduled dispatcher");
    // A doc template is not a diagram template.
    const [docTemplate] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.kind, "doc"))
      .limit(1);
    await expect(create("Nope", "flow", docTemplate?.id)).rejects.toThrow("Template not found");
  });

  it("saves with optimistic locking: the loser gets the winner's copy, Keep mine re-bases", async () => {
    const { id } = await create("Contested");
    expect(expectSaved(await save(id, 1, flow("mine")))).toMatchObject({ version: 2 });
    const lost = await save(id, 1, flow("theirs"), { by: other });
    expect(lost).toMatchObject({
      status: "conflict",
      latest: { version: 2, scene: flow("mine"), updatedByName: "Ada Actor" },
    });
    // "Keep mine": the same copy, based on the winner's version; still a locked save.
    expect(expectSaved(await save(id, 2, flow("theirs"), { by: other }))).toMatchObject({
      version: 3,
    });
    expect(await save(id, 2, flow("late"))).toMatchObject({ status: "conflict" });
    const detail = await queries().getDiagram(projectIdByKey("STK"), id);
    expect(detail).toMatchObject({
      version: 3,
      scene: flow("theirs"),
      updatedByName: "Rita Rival",
    });
  });

  it("derives scene_text from the scene, for both kinds", async () => {
    const f = await create("Text flow");
    await save(f.id, 1, flow("inventory-api", "MongoDB"));
    const w = await create("Text board", "whiteboard");
    await save(w.id, 1, board("OCR provider"));
    const rows = await db
      .select({ id: diagrams.id, text: diagrams.sceneText })
      .from(diagrams)
      .where(sql`${diagrams.id} IN (${f.id}::uuid, ${w.id}::uuid)`);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.text]))).toEqual({
      [f.id]: "inventory-api\nMongoDB",
      [w.id]: "OCR provider",
    });
  });

  it("snapshots when the last one is over 10 minutes old, or on Save version (§7.4)", async () => {
    const { id } = await create("Cadence");
    expect(expectSaved(await save(id, 1, flow("a"))).snapshotted).toBe(false);
    expect(expectSaved(await save(id, 2, flow("b"), { snapshot: true })).snapshotted).toBe(true);
    expect(expectSaved(await save(id, 3, flow("c"))).snapshotted).toBe(false);
    await db.execute(sql`
      UPDATE diagram_versions SET created_at = created_at - interval '11 minutes'
      WHERE diagram_id = ${id}::uuid
    `);
    expect(expectSaved(await save(id, 4, flow("d"))).snapshotted).toBe(true);
    expect(await versionsOf(id)).toEqual([1, 3, 5]);
    const history = await queries().listVersions(id);
    expect(history.map((v) => v.version)).toEqual([5, 3, 1]);
    expect(await queries().getVersion(id, 3)).toMatchObject({ kind: "flow", scene: flow("b") });
  });

  it(`keeps at most ${DIAGRAM_VERSION_CAP} snapshots, pruning the oldest (§7.3)`, async () => {
    const { id } = await create("Busy");
    for (let version = 1; version <= DIAGRAM_VERSION_CAP + 4; version += 1) {
      await save(id, version, flow(`v${version + 1}`), { snapshot: true });
    }
    const kept = await versionsOf(id);
    expect(kept).toHaveLength(DIAGRAM_VERSION_CAP);
    expect(kept.at(-1)).toBe(DIAGRAM_VERSION_CAP + 5);
    expect(kept[0]).toBe(6);
  });

  it("restores an old version as a NEW version and never rewrites history (DGM-4)", async () => {
    const { id } = await create("Restorable");
    await save(id, 1, flow("second"), { snapshot: true });
    await save(id, 2, flow("third"), { snapshot: true });
    const restored = expectSaved(
      await service().restoreVersion(actor, { diagramId: id, version: 1, baseVersion: 3 }),
    );
    expect(restored).toMatchObject({ version: 4, snapshotted: true });
    expect(await versionsOf(id)).toEqual([1, 2, 3, 4]);
    expect((await queries().getVersion(id, 4))?.scene).toEqual(
      (await queries().getVersion(id, 1))?.scene,
    );
    expect((await queries().getVersion(id, 3))?.scene).toEqual(flow("third"));
    const [log] = await db
      .select({ from: activity.fromValue, to: activity.toValue })
      .from(activity)
      .where(and(eq(activity.entityId, id), eq(activity.action, "restored")));
    expect(log).toEqual({ from: "1", to: "4" });
    // Locked like a save: restoring over a newer version conflicts.
    expect(
      await service().restoreVersion(actor, { diagramId: id, version: 2, baseVersion: 3 }),
    ).toMatchObject({ status: "conflict", latest: { version: 4 } });
    await expect(
      service().restoreVersion(actor, { diagramId: id, version: 99, baseVersion: 4 }),
    ).rejects.toThrow("Version 99 not found");
  });

  it("refuses an oversized scene with a clear message, and the DB accepts one at the limit", async () => {
    const { id } = await create("Huge", "whiteboard");
    const sized = (bytes: number): WhiteboardScene => {
      const of = (text: string): WhiteboardScene => ({
        elements: [{ id: "t", type: "text", text }],
        appState: {},
      });
      return of("x".repeat(bytes - sceneByteSize(of(""))));
    };
    await expect(save(id, 1, sized(DIAGRAM_SCENE_INPUT_MAX_BYTES + 1))).rejects.toThrow(
      new ServiceError("invalid", SCENE_TOO_LARGE_MESSAGE),
    );
    // At the input limit the jsonb text is still under the 2 MB CHECK.
    expect(await save(id, 1, sized(DIAGRAM_SCENE_INPUT_MAX_BYTES))).toMatchObject({
      status: "saved",
    });
    await expect(save(id, 2, flow("wrong kind"))).rejects.toBeInstanceOf(ServiceError);
  });

  it("logs title changes (save and rename) and bumps the version on rename", async () => {
    const { id } = await create("Old name");
    await save(id, 1, flow("x"), { title: "New name" });
    expect(await service().renameDiagram(actor, { diagramId: id, title: "Newest" })).toEqual({
      version: 3,
    });
    // An editor open on v2 now conflicts instead of undoing the rename.
    expect(await save(id, 2, flow("x"))).toMatchObject({ status: "conflict" });
    const rows = await db
      .select({ from: activity.fromValue, to: activity.toValue })
      .from(activity)
      .where(and(eq(activity.entityId, id), eq(activity.field, "title")))
      .orderBy(asc(activity.createdAt));
    expect(rows).toEqual([
      { from: "Old name", to: "New name" },
      { from: "New name", to: "Newest" },
    ]);
  });

  it("orders the list with fractional keys and moves one card at a time", async () => {
    const before = (await queries().listDiagrams(projectIdByKey("STK"))).map((card) => card.id);
    const last = before.at(-1);
    if (!last) throw new Error("no diagrams");
    await service().moveDiagram(actor, { diagramId: last, index: 0 });
    const after = (await queries().listDiagrams(projectIdByKey("STK"))).map((card) => card.id);
    expect(after).toEqual([last, ...before.slice(0, -1)]);
    // Equal keys (possible after concurrent creates) are respaced, not left tied.
    await db.execute(sql`UPDATE diagrams SET position = 'a0' WHERE deleted_at IS NULL`);
    await service().moveDiagram(actor, { diagramId: last, index: 1 });
    const positions = (await queries().listDiagrams(projectIdByKey("STK"))).map((c) => c.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("searches the list by title and labels", async () => {
    const { id } = await create("Payments");
    await save(id, 1, flow("ledgerservice"));
    const hits = await queries().listDiagrams(projectIdByKey("STK"), "ledgerservice");
    expect(hits.map((card) => card.id)).toEqual([id]);
    expect(await queries().listDiagrams(projectIdByKey("STK"), "-ledgerservice")).toEqual([]);
  });

  it("includes diagrams in ⌘K search with their kind and editor link (SRCH-1, §5.7)", async () => {
    const { id } = await create("Zebracorn flow");
    await save(id, 1, flow("dispatcherzz"));
    const results = await createSearchService(db).search("dispatcherzz");
    expect(results.diagrams).toEqual([
      expect.objectContaining({
        kind: "diagram",
        id,
        title: "Zebracorn flow",
        context: "Flow",
        href: `/STK/diagrams/${id}`,
      }),
    ]);
    expect((await createSearchService(db).search("zebracorn")).diagrams).toHaveLength(1);
  });

  it("soft-deletes: gone from the list, the page, search and the thumbnail route", async () => {
    const { id } = await create("Doomed");
    await db.execute(sql`
      UPDATE diagrams SET thumbnail_key = ${`thumbnails/diagrams/${id}.png`} WHERE id = ${id}::uuid
    `);
    expect(await createFileQueries(db).diagramThumbnail(id)).not.toBeNull();
    await service().deleteDiagram(actor, id);
    expect(await queries().getDiagram(projectIdByKey("STK"), id)).toBeNull();
    expect((await queries().listDiagrams(projectIdByKey("STK"))).map((c) => c.id)).not.toContain(
      id,
    );
    expect((await createSearchService(db).search("doomed")).diagrams).toEqual([]);
    expect(await createFileQueries(db).diagramThumbnail(id)).toBeNull();
    await expect(service().deleteDiagram(actor, id)).rejects.toThrow("Diagram not found");
    await expect(save(id, 1, flow("x"))).rejects.toThrow("Diagram not found");
  });

  it("links issues and docs, and finds docs that embed the diagram (Linked panel)", async () => {
    const { id } = await create("Linked flow");
    const issue = await createIssueService(db, { runAtomic: transactionRunner(db) }).createIssue(
      actor,
      { projectKey: "STK", title: "OOM in OCR upload", type: "bug", priority: 2 },
    );
    const docs = createDocService(db, { runAtomic: transactionRunner(db) });
    const linkedDoc = await docs.createDoc(actor, {
      projectKey: "STK",
      title: "ADR notes",
      type: "page",
    });
    const embedding = await docs.createDoc(actor, {
      projectKey: "STK",
      title: "Upload design",
      type: "page",
    });
    const content: RichTextDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "See:" }] },
        {
          type: "diagramEmbed",
          attrs: { diagramId: id, title: "Linked flow", projectKey: "STK", kind: "flow" },
        },
      ],
    };
    await docs.saveDoc(actor, { docId: embedding.id, baseVersion: 1, content, snapshot: false });

    const issueLink = await service().link(actor, {
      diagramId: id,
      target: "issue",
      issueKey: issue.key,
    });
    await service().link(actor, { diagramId: id, target: "doc", docId: linkedDoc.id });
    await expect(
      service().link(actor, { diagramId: id, target: "issue", issueKey: issue.key }),
    ).rejects.toThrow("already linked");
    await expect(
      service().link(actor, { diagramId: id, target: "issue", issueKey: "STK-99999" }),
    ).rejects.toThrow("not found");

    const links = await queries().links(id);
    expect(links.map(({ kind, source, label, href }) => ({ kind, source, label, href }))).toEqual(
      expect.arrayContaining([
        {
          kind: "issue",
          source: "manual",
          label: `${issue.key} OOM in OCR upload`,
          href: `/STK/issues/${issue.key}`,
        },
        { kind: "doc", source: "manual", label: "ADR notes", href: `/STK/docs/${linkedDoc.id}` },
        { kind: "doc", source: "embed", label: "Upload design", href: `/STK/docs/${embedding.id}` },
      ]),
    );
    expect(links).toHaveLength(3);

    await service().unlink(actor, { diagramId: id, linkId: issueLink.linkId });
    expect((await queries().links(id)).map((link) => link.kind)).not.toContain("issue");
    // The embed follows the doc: deleting the doc removes the backlink.
    await docs.deleteDoc(actor, embedding.id);
    expect((await queries().links(id)).map((link) => link.source)).toEqual(["manual"]);
  });

  describe("thumbnails (DGM-5)", () => {
    const config = {
      accountId: "acct",
      accessKeyId: "id",
      secretAccessKey: "secret",
      bucket: "hq",
    };

    it("skips quietly without storage, touching neither the DB row nor R2", async () => {
      const { id } = await create("No storage");
      expect(
        await service().requestThumbnailUpload(actor, { diagramId: id, sizeBytes: 100 }),
      ).toEqual({ status: "skipped" });
      expect(await service().confirmThumbnail(actor, id)).toEqual({ status: "skipped" });
    });

    it("presigns exactly thumbnails/diagrams/<id>.png, then confirms a PNG and records it", async () => {
      const { id } = await create("With storage");
      const presign = vi.fn<StorageTransport["presign"]>(
        async () => "https://signed.example.test/put",
      );
      const send = vi.fn<StorageTransport["send"]>(async () => ({
        ContentLength: 1234,
        ContentType: "image/png",
      }));
      const storage = createStorage(config, () => ({ presign, send }));
      const upload = await service(storage).requestThumbnailUpload(actor, {
        diagramId: id,
        sizeBytes: 1234,
      });
      expect(upload).toEqual({
        status: "upload",
        url: "https://signed.example.test/put",
        headers: { "Content-Type": "image/png" },
      });
      const command = presign.mock.calls[0]?.[0];
      expect(command?.input).toMatchObject({
        Key: `thumbnails/diagrams/${id}.png`,
        ContentType: "image/png",
        ContentLength: 1234,
      });

      expect(await service(storage).confirmThumbnail(actor, id)).toEqual({ status: "saved" });
      expect((await queries().getDiagram(projectIdByKey("STK"), id))?.hasThumbnail).toBe(true);
      // The version is unchanged: a thumbnail is not an edit.
      expect((await queries().getDiagram(projectIdByKey("STK"), id))?.version).toBe(1);
    });

    it("refuses a confirm when the object is missing or not a PNG", async () => {
      const { id } = await create("Bad upload");
      const notPng = createStorage(config, () => ({
        presign: async () => "",
        send: async () => ({ ContentLength: 10, ContentType: "text/html" }),
      }));
      await expect(service(notPng).confirmThumbnail(actor, id)).rejects.toThrow("must be a PNG");
      const missing = createStorage(config, () => ({
        presign: async () => "",
        send: async () => Promise.reject(Object.assign(new Error("nf"), { name: "NotFound" })),
      }));
      await expect(service(missing).confirmThumbnail(actor, id)).rejects.toThrow("not found");
      await expect(
        service(notPng).requestThumbnailUpload(actor, {
          diagramId: crypto.randomUUID(),
          sizeBytes: 10,
        }),
      ).rejects.toThrow("Diagram not found");
    });
  });
});
