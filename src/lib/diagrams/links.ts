/**
 * Diagram URLs (DGM-*). Isomorphic. Paths are always built from validated parts (a project
 * key, a uuid, an issue key), never taken from stored strings, so a scene cannot carry a
 * link elsewhere.
 */

import { docPath } from "@/lib/docs/views";
import { issuePathForKey, PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A canonical issue key such as `STK-12` (upper case, as stored in node links). */
export const ISSUE_KEY_INPUT_PATTERN = /^[A-Z]{2,5}-[1-9]\d{0,9}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function diagramsPath(projectKey: string): string {
  return `/${projectKey}/diagrams`;
}

/** `/STK/diagrams/<id>` */
export function diagramPath(projectKey: string, diagramId: string): string {
  return `/${projectKey}/diagrams/${diagramId}`;
}

/** DGM-5 thumbnail through the authed file route (302 to a short-lived signed URL). */
export function diagramThumbnailPath(diagramId: string, cacheKey?: string | number): string {
  const base = `/api/files/thumbnail/diagram/${diagramId}`;
  return cacheKey === undefined ? base : `${base}?v=${encodeURIComponent(String(cacheKey))}`;
}

/** A diagram path only when both parts are well-formed; otherwise null. */
export function safeDiagramPath(projectKey: unknown, diagramId: unknown): string | null {
  if (typeof projectKey !== "string" || !PROJECT_KEY_PATTERN.test(projectKey)) return null;
  if (!isUuid(diagramId)) return null;
  return diagramPath(projectKey, diagramId);
}

/** DGM-7: where a linked flow node opens. */
export function nodeLinkPath(
  link: { kind: "issue"; key: string } | { kind: "doc"; id: string },
  projectKey: string,
): string {
  return link.kind === "issue" ? issuePathForKey(link.key) : docPath(projectKey, link.id);
}
