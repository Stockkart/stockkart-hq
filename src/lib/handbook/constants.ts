/**
 * Handbook two-way sync vocabulary (DOC-12, DOC-14; migration 0006). Isomorphic. The regex
 * sources back the CHECKs in `schema.ts` (POSIX syntax, so no `\d` or lookarounds) and are
 * reused by the Zod schemas of the sync slice.
 */

/** `handbook_publications.state`: a PR HQ opened on the handbook repo through the App. */
export const HANDBOOK_PUBLICATION_STATES = ["open", "merged", "closed", "failed"] as const;
export type HandbookPublicationState = (typeof HANDBOOK_PUBLICATION_STATES)[number];

/** A git blob (or commit) SHA-1, lower-case hex as the GitHub API returns it. */
export const GIT_SHA_REGEX_SOURCE = "^[0-9a-f]{40}$";
export const GIT_SHA_PATTERN = new RegExp(GIT_SHA_REGEX_SOURCE);

/**
 * HQ only ever pushes branches under `hq/` (one segment after the prefix), so the App can
 * never write to a branch a person made, and the name is a valid git ref (no `..`, no
 * trailing `.lock`, also CHECKed).
 */
export const HANDBOOK_BRANCH_PREFIX = "hq/";
export const HANDBOOK_BRANCH_REGEX_SOURCE = "^hq/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$";

export const HANDBOOK_PR_URL_REGEX_SOURCE =
  "^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]{0,9}$";

/** `handbook_publications.error_code`: a short machine code (`conflict`, `github_403` …). */
export const HANDBOOK_ERROR_CODE_REGEX_SOURCE = "^[a-z0-9_.-]{1,64}$";
