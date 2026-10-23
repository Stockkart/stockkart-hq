import { type DocThreadView } from "@/lib/doc-comments/views";
import { type DocDetail, type DocTreeItem } from "@/lib/docs/views";
import { type RichTextDoc, rt } from "@/lib/rich-text";

/** Fixtures for the doc page UI tests (docs UX). Plain data, no real content. */

export const DOC_ID = "11111111-1111-4111-8111-111111111111";
export const USER_ID = "22222222-2222-4222-8222-222222222222";

export const body = (...paragraphs: string[]): RichTextDoc =>
  rt.doc(...paragraphs.map((text) => rt.paragraph(text)));

export function docDetail(patch: Partial<DocDetail> = {}): DocDetail {
  return {
    id: DOC_ID,
    projectId: "33333333-3333-4333-8333-333333333333",
    projectKey: "STK",
    parentId: null,
    title: "Runbook",
    type: "page",
    status: "draft",
    content: body("First paragraph of the runbook.", "Second paragraph."),
    version: 3,
    ownerId: USER_ID,
    updatedByName: "Ada",
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-02T10:00:00Z"),
    adrNumber: null,
    adrStatus: null,
    adrSupersededBy: null,
    handbook: null,
    ...patch,
  };
}

export const treeItem = (
  id: string,
  title: string,
  parentId: string | null = null,
  position = "a0",
): DocTreeItem => ({
  id,
  parentId,
  position,
  title,
  type: "page",
  status: "draft",
  ownerName: null,
  updatedByName: null,
  updatedAt: new Date(0),
});

export function thread(patch: Partial<DocThreadView> = {}): DocThreadView {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    authorId: USER_ID,
    authorName: "Ada",
    body: body("A comment"),
    createdAt: new Date("2026-01-02T11:00:00Z"),
    editedAt: null,
    anchorId: null,
    anchorText: null,
    resolvedAt: null,
    resolvedByName: null,
    replies: [],
    ...patch,
  };
}
