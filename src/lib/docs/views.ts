import { type HandbookDocSync } from "@/lib/handbook/views";
import { type ChildIssue } from "@/lib/issues/views";
import { type RichTextDoc } from "@/lib/rich-text";

import { type AdrStatus, type DocStatus, type DocType } from "./constants";

/** Read models passed from server components to client components. Plain data only. */

export interface DocTreeItem {
  id: string;
  parentId: string | null;
  position: string;
  title: string;
  type: DocType;
  status: DocStatus;
  ownerName: string | null;
  updatedByName: string | null;
  updatedAt: Date;
}

export interface DocRef {
  id: string;
  title: string;
}

export interface DocDetail {
  id: string;
  projectId: string;
  projectKey: string;
  parentId: string | null;
  title: string;
  type: DocType;
  status: DocStatus;
  content: RichTextDoc | null;
  version: number;
  ownerId: string | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  adrNumber: number | null;
  adrStatus: AdrStatus | null;
  adrSupersededBy: DocRef | null;
  /**
   * DOC-14 stored handbook sync state (no GitHub call), read by `getDoc` in the same query;
   * null for the importer's group pages, which are not files.
   */
  handbook: HandbookDocSync | null;
}

export interface DocVersionView {
  version: number;
  authorName: string | null;
  createdAt: Date;
}

/** DOC-10: one snapshot with its content, for the diff and the read-only preview. */
export interface DocVersionDetail extends DocVersionView {
  title: string;
  content: RichTextDoc | null;
}

/** ADR-3: an ADR this one supersedes ("Supersedes ADR-0007"). */
export interface AdrRef {
  id: string;
  title: string;
  adrNumber: number | null;
}

export interface LinkedIssueView {
  /** Present for links stored from this doc (they can be removed if manual). */
  linkId: string;
  origin: "manual" | "mention";
  issue: ChildIssue;
}

export interface AdrRow {
  id: string;
  number: number;
  title: string;
  status: AdrStatus | null;
  supersededByNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
  linkedIssueKeys: string[];
}

export interface DocTemplateView {
  id: string;
  subtype: string;
  name: string;
  description: string | null;
  content: RichTextDoc;
}

/** A doc that links to an issue, for the issue's Links panel (DOC-9). */
export interface LinkedDocView {
  id: string;
  title: string;
  type: DocType;
  origin: "manual" | "mention";
}

/** `/STK/docs/<id>`; slice 2's search links here too. */
export function docPath(projectKey: string, docId: string): string {
  return `/${projectKey}/docs/${docId}`;
}

/** The doc in edit mode (`?edit=1`): new docs open like this. */
export function docEditPath(projectKey: string, docId: string): string {
  return `${docPath(projectKey, docId)}?edit=1`;
}
