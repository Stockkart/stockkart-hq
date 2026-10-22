"use server";

import { type ActionResult } from "@/lib/action-result";
import {
  createDiagramInput,
  diagramIdInput,
  diagramVersionInput,
  linkDiagramInput,
  moveDiagramInput,
  pickerQueryInput,
  renameDiagramInput,
  restoreDiagramVersionInput,
  saveDiagramInput,
  thumbnailUploadInput,
  unlinkDiagramInput,
} from "@/lib/diagrams/schemas";
import {
  type DiagramOption,
  type DiagramTemplateView,
  type DiagramVersionScene,
} from "@/lib/diagrams/views";
import { requireSession } from "@/server/auth/require-session";
import { diagramQueries, diagramService } from "@/server/services";
import {
  type CreatedDiagram,
  type SaveDiagramResult,
  type ThumbnailUpload,
} from "@/server/services/diagrams";
import { notFound } from "@/server/services/errors";

import { runAction } from "./action-runner";
import { DIAGRAM_PAGE, DIAGRAMS, refreshPages } from "./refresh";

/**
 * Diagram actions (DGM-*). Each re-checks the session first (S-2: action ids can be POSTed
 * from anywhere), then validates its untrusted input with Zod, then calls a service.
 * Expected failures come back as `{ ok: false, error }`; a missing session throws.
 */

const none = () => {};
const list = () => refreshPages(DIAGRAMS);
const listAndPage = () => refreshPages(DIAGRAMS, DIAGRAM_PAGE);

export async function createDiagramAction(input: unknown): Promise<ActionResult<CreatedDiagram>> {
  const session = await requireSession();
  return runAction(
    createDiagramInput,
    input,
    (data) => diagramService.createDiagram(session.user.id, data),
    list,
  );
}

/**
 * §7.4 autosave. Not revalidated: it runs every few seconds while editing and the editor
 * holds the saved state; the client refreshes when the title or the history changed.
 */
export async function saveDiagramAction(input: unknown): Promise<ActionResult<SaveDiagramResult>> {
  const session = await requireSession();
  return runAction(
    saveDiagramInput,
    input,
    (data) => diagramService.saveDiagram(session.user.id, data),
    none,
  );
}

export async function renameDiagramAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  const session = await requireSession();
  return runAction(
    renameDiagramInput,
    input,
    (data) => diagramService.renameDiagram(session.user.id, data),
    listAndPage,
  );
}

export async function deleteDiagramAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    diagramIdInput,
    input,
    async (data) => {
      await diagramService.deleteDiagram(session.user.id, data.diagramId);
      return undefined;
    },
    list,
  );
}

export async function moveDiagramAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    moveDiagramInput,
    input,
    async (data) => {
      await diagramService.moveDiagram(session.user.id, data);
      return undefined;
    },
    list,
  );
}

/** DGM-4 restore: a new version with the old scene. */
export async function restoreDiagramVersionAction(
  input: unknown,
): Promise<ActionResult<SaveDiagramResult>> {
  const session = await requireSession();
  return runAction(
    restoreDiagramVersionInput,
    input,
    (data) => diagramService.restoreVersion(session.user.id, data),
    listAndPage,
  );
}

/** DGM-4 read-only preview of an old version. */
export async function loadDiagramVersionAction(
  input: unknown,
): Promise<ActionResult<DiagramVersionScene>> {
  await requireSession();
  return runAction(
    diagramVersionInput,
    input,
    async (data) => {
      const version = await diagramQueries.getVersion(data.diagramId, data.version);
      if (!version) throw notFound(`Version ${data.version}`);
      return version;
    },
    none,
  );
}

export async function linkDiagramAction(input: unknown): Promise<ActionResult<{ linkId: string }>> {
  const session = await requireSession();
  return runAction(
    linkDiagramInput,
    input,
    (data) => diagramService.link(session.user.id, data),
    () => refreshPages(DIAGRAM_PAGE),
  );
}

export async function unlinkDiagramAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    unlinkDiagramInput,
    input,
    async (data) => {
      await diagramService.unlink(session.user.id, data);
      return undefined;
    },
    () => refreshPages(DIAGRAM_PAGE),
  );
}

/** DGM-3 picker contents, loaded when "New from template" first opens. */
export async function loadDiagramTemplatesAction(): Promise<ActionResult<DiagramTemplateView[]>> {
  await requireSession();
  return { ok: true, data: await diagramQueries.diagramTemplates() };
}

/** DOC-8 "Insert diagram" picker. */
export async function searchDiagramOptionsAction(
  input: unknown,
): Promise<ActionResult<DiagramOption[]>> {
  await requireSession();
  return runAction(
    pickerQueryInput,
    input,
    (data) => diagramQueries.diagramOptions(data.projectKey, data.q),
    none,
  );
}

/** "Linked" panel → link a doc: docs of the project by title. */
export async function searchLinkableDocsAction(
  input: unknown,
): Promise<ActionResult<{ id: string; title: string }[]>> {
  await requireSession();
  return runAction(
    pickerQueryInput,
    input,
    (data) => diagramQueries.docOptions(data.projectKey, data.q),
    none,
  );
}

/** DGM-5 step 1: presigned PUT for the diagram's thumbnail (or "skipped" without R2). */
export async function requestThumbnailUploadAction(
  input: unknown,
): Promise<ActionResult<ThumbnailUpload>> {
  const session = await requireSession();
  return runAction(
    thumbnailUploadInput,
    input,
    (data) => diagramService.requestThumbnailUpload(session.user.id, data),
    none,
  );
}

/** DGM-5 step 2: confirm the uploaded PNG and record it on the diagram. */
export async function confirmThumbnailAction(
  input: unknown,
): Promise<ActionResult<{ status: "skipped" } | { status: "saved" }>> {
  const session = await requireSession();
  return runAction(
    diagramIdInput,
    input,
    (data) => diagramService.confirmThumbnail(session.user.id, data.diagramId),
    list,
  );
}
