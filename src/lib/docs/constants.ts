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
