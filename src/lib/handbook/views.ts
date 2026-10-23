import { type DocType } from "@/lib/docs/constants";
import { type LineDiffHunk } from "@/lib/text/line-diff";

import { type HandbookPublicationState, type HandbookSyncStatus } from "./constants";

/**
 * View types of the handbook sync (DOC-14). Isomorphic: server queries and services build
 * them, client components render them.
 */

/** A doc's stored sync state (doc page badge, settings table). No GitHub call behind it. */
export interface HandbookDocSync {
  docId: string;
  title: string;
  type: DocType;
  /** The repo path it publishes to (`handbookPathFor`). */
  path: string;
  status: HandbookSyncStatus;
  version: number;
  syncedVersion: number | null;
  syncedAt: Date | null;
  remoteSeenAt: Date | null;
  pr: { number: number | null; url: string | null } | null;
}

/** Configuration as the UI may see it: never the key or ids beyond the repo name. */
export interface HandbookConfigView {
  configured: boolean;
  repo: string;
  repoUrl: string;
}

export interface HandbookPublicationView {
  id: string;
  branch: string;
  state: HandbookPublicationState;
  prNumber: number | null;
  prUrl: string | null;
  errorCode: string | null;
  createdAt: Date;
  mergedAt: Date | null;
  createdByName: string | null;
  docCount: number;
}

/** Publish dialog contents (server action, on demand: it asks GitHub). */
export interface PublishPreview {
  docId: string;
  path: string;
  markdown: string;
  /** The file on the default branch, if it exists. */
  remote: { sha: string; diff: LineDiffHunk[] } | null;
  /** The markdown equals the repo file: publishing changes nothing. */
  unchanged: boolean;
  /** The repo file changed since the last sync: publishing needs the explicit overwrite. */
  needsOverwrite: boolean;
  /** A secret-looking value: publishing is blocked (no override). */
  secret: string | null;
  /** The path is one GitHub gives a meaning to (README.md, LICENSE.md, the ADR template …). */
  specialPath: boolean;
}

export type PullState = "repo_ahead" | "both_changed" | "in_sync" | "hq_ahead" | "removed";

/** Pull dialog contents: HQ's markdown (old) → the handbook's (new). */
export interface PullPreview {
  docId: string;
  path: string;
  state: PullState;
  baseVersion: number;
  remoteSha: string | null;
  diff: LineDiffHunk[];
}

export interface PublishOutcome {
  pr: { number: number; url: string } | null;
  published: { docId: string; title: string; path: string }[];
  /** Equal to the repo file already (now recorded as in sync). */
  unchanged: { docId: string; title: string }[];
  refused: { docId: string; title: string; reason: string }[];
}

export interface CheckOutcome {
  checked: number;
  /** Docs whose file differs from what HQ last synced, or is gone. */
  drifted: number;
  /** Top-level and `decisions/NNNN-*.md` files no doc maps to. */
  newFiles: { path: string; sha: string }[];
}
