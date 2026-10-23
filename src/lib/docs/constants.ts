/**
 * Doc vocabulary (SPEC §4.11, §4.12). Isomorphic: safe to import from client components.
 * Defined in Phase 1 slice 1 so the schema covers all of Phase 1 up front.
 */

/** DOC-3. */
export const DOC_TYPES = [
  "page",
  "design",
  "lld",
  "adr",
  "rfc",
  "api_contract",
  "runbook",
  "postmortem",
  "load_test_report",
  "meeting_notes",
  "retro",
  "release_notes",
  "onboarding",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** DOC-4. */
export const DOC_STATUSES = ["draft", "in_review", "approved", "obsolete"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** ADR-2. "Superseded by NNNN" is `superseded` plus `docs.adr_superseded_by`. */
export const ADR_STATUSES = [
  "proposed",
  "accepted",
  "accepted_retrospective",
  "deprecated",
  "superseded",
] as const;
export type AdrStatus = (typeof ADR_STATUSES)[number];

/** `templates.kind` (SPEC §8). */
export const TEMPLATE_KINDS = ["doc", "issue", "diagram"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/**
 * DOC-13 inline comments: `comments.anchor_id` is the id of the comment mark in the doc JSON
 * (stable across edits, so it never holds offsets), `anchor_text` the quoted selection at the
 * time of commenting. Both are only used on doc comments (a CHECK enforces it).
 */
export const DOC_COMMENT_ANCHOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DOC_COMMENT_ANCHOR_TEXT_MAX = 500;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  page: "Page",
  design: "Design (HLD)",
  lld: "LLD",
  adr: "ADR",
  rfc: "RFC",
  api_contract: "API contract",
  runbook: "Runbook",
  postmortem: "Postmortem",
  load_test_report: "Load-test report",
  meeting_notes: "Meeting notes",
  retro: "Retro",
  release_notes: "Release notes",
  onboarding: "Onboarding",
};

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  obsolete: "Obsolete",
};

export const ADR_STATUS_LABELS: Record<AdrStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  accepted_retrospective: "Accepted (recorded retrospectively)",
  deprecated: "Deprecated",
  superseded: "Superseded",
};

/** Doc types a person can pick for a doc. ADRs are made only by "New ADR" (ADR-1 numbering). */
export const PICKABLE_DOC_TYPES = DOC_TYPES.filter((type) => type !== "adr");

export function isDocType(value: string): value is DocType {
  return (DOC_TYPES as readonly string[]).includes(value);
}
