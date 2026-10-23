"use server";

import { revalidatePath } from "next/cache";
import { type z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import {
  createAdrInput,
  createDocInput,
  docIdInput,
  docVersionInput,
  linkIssueInput,
  moveDocInput,
  renameDocInput,
  restoreDocVersionInput,
  saveDocInput,
  supersedeAdrInput,
  unlinkIssueInput,
  updateDocMetaInput,
} from "@/lib/docs/schemas";
import { type DocTemplateView, type DocVersionDetail } from "@/lib/docs/views";
import { requireSession } from "@/server/auth/require-session";
import { docQueries, docService } from "@/server/services";
import { type CreatedDoc, type SaveDocResult } from "@/server/services/docs";
import { notFound } from "@/server/services/errors";

import { runAction } from "./action-runner";

/**
 * Doc and ADR mutations (DOC-*, ADR-*). Each action re-checks the session first (S-2: action
 * ids can be POSTed from anywhere), then validates its untrusted input with Zod, then calls
 * a service. Expected failures come back as `{ ok: false, error }`; a missing session throws.
 */

/** The tree is in the docs layout and the ADR log lists ADRs, so refresh both subtrees. */
function refreshDocPages() {
  revalidatePath("/[projectKey]/docs", "layout");
  revalidatePath("/[projectKey]/adrs", "page");
}

/**
 * Parse, call and map failures through the shared `runAction` (planning's action-runner.ts).
 * Its FK mapping covers a referenced user, doc or template deleted between the check and
 * the write. The caller has already run `await requireSession()`.
 */
async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  action: (data: z.output<S>) => Promise<T>,
  { revalidate = true }: { revalidate?: boolean } = {},
): Promise<ActionResult<T>> {
  return runAction(schema, input, action, revalidate ? refreshDocPages : () => {});
}

export async function createDocAction(input: unknown): Promise<ActionResult<CreatedDoc>> {
  const session = await requireSession();
  return run(createDocInput, input, (data) => docService.createDoc(session.user.id, data));
}

export async function createAdrAction(
  input: unknown,
): Promise<ActionResult<CreatedDoc & { number: number }>> {
  const session = await requireSession();
  return run(createAdrInput, input, (data) => docService.createAdr(session.user.id, data));
}

/**
 * §7.4 autosave. Not revalidated: it runs every few seconds while typing, and the editor
 * already holds the saved state; the client refreshes the page when the title or the
 * issue references changed (tree, breadcrumb, Linked issues).
 */
export async function saveDocAction(input: unknown): Promise<ActionResult<SaveDocResult>> {
  const session = await requireSession();
  return run(saveDocInput, input, (data) => docService.saveDoc(session.user.id, data), {
    revalidate: false,
  });
}

export async function renameDocAction(input: unknown): Promise<ActionResult<{ version: number }>> {
  const session = await requireSession();
  return run(renameDocInput, input, (data) => docService.renameDoc(session.user.id, data));
}

export async function updateDocMetaAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(updateDocMetaInput, input, async (data) => {
    await docService.updateMeta(session.user.id, data);
    return undefined;
  });
}

export async function moveDocAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(moveDocInput, input, async (data) => {
    await docService.moveDoc(session.user.id, data);
    return undefined;
  });
}

export async function deleteDocAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(docIdInput, input, async (data) => {
    await docService.deleteDoc(session.user.id, data.docId);
    return undefined;
  });
}

export async function linkDocIssueAction(
  input: unknown,
): Promise<ActionResult<{ linkId: string }>> {
  const session = await requireSession();
  return run(linkIssueInput, input, (data) => docService.linkIssue(session.user.id, data));
}

export async function unlinkDocIssueAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(unlinkIssueInput, input, async (data) => {
    await docService.unlinkIssue(session.user.id, data);
    return undefined;
  });
}

/** DOC-5 picker contents, loaded when the "New from template" dialog first opens. */
export async function loadDocTemplatesAction(): Promise<ActionResult<DocTemplateView[]>> {
  await requireSession();
  return { ok: true, data: await docQueries.docTemplates() };
}

/** DOC-10: one snapshot's title and content, loaded when a version is opened (diff, preview). */
export async function loadDocVersionAction(
  input: unknown,
): Promise<ActionResult<DocVersionDetail>> {
  await requireSession();
  return run(
    docVersionInput,
    input,
    async (data) => {
      const version = await docQueries.getVersion(data.docId, data.version);
      if (!version) throw notFound(`Version ${data.version}`);
      return version;
    },
    { revalidate: false },
  );
}

/**
 * DOC-10 restore: a new version with the old title and content, locked like a save. A
 * conflict comes back as data (the banner path), like `saveDocAction`.
 */
export async function restoreDocVersionAction(
  input: unknown,
): Promise<ActionResult<SaveDocResult>> {
  const session = await requireSession();
  return run(restoreDocVersionInput, input, (data) =>
    docService.restoreVersion(session.user.id, data),
  );
}

/** ADR-3 "Supersede with new ADR…": the new ADR (opened in edit mode by the client). */
export async function supersedeAdrAction(
  input: unknown,
): Promise<ActionResult<CreatedDoc & { number: number }>> {
  const session = await requireSession();
  return run(supersedeAdrInput, input, (data) => docService.supersedeAdr(session.user.id, data));
}
