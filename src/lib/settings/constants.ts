/**
 * Project settings vocabulary (PRJ-2, PRJ-3). Isomorphic: shared by the settings forms, the
 * Zod schemas and the services.
 */

/**
 * The label colour palette (PRJ-3). A small fixed set, so every label stays readable on
 * light and dark backgrounds and the picker stays a short list. Stored as the hex value.
 */
export const LABEL_COLOR_VALUES = [
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;
export type LabelColor = (typeof LABEL_COLOR_VALUES)[number];

/** The colour names people pick by (and screen readers read). */
export const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  "#64748b": "Slate",
  "#ef4444": "Red",
  "#f97316": "Orange",
  "#eab308": "Yellow",
  "#22c55e": "Green",
  "#14b8a6": "Teal",
  "#3b82f6": "Blue",
  "#8b5cf6": "Violet",
  "#ec4899": "Pink",
};

/**
 * PRJ-2 `Owner/repo`, as GitHub allows them: an owner of 1–39 letters, digits or inner
 * hyphens, and a repository name of letters, digits, `.`, `_` or `-` (not `.` or `..`).
 */
export const GITHUB_REPO_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const STATUS_NAME_MAX = 40;
export const COMPONENT_NAME_MAX = 60;

/** BRD-5 WIP limit range (the `statuses_wip_limit_range` CHECK). Empty = no limit. */
export const WIP_LIMIT_MIN = 1;
export const WIP_LIMIT_MAX = 999;

/** Settings tabs, also the `?tab=` URL value. `import`: IMP-4 CSV import of issues;
 * `handbook`: DOC-14 engineering-handbook sync; `views`: BRD-6 / VW-4 board and issue-list
 * defaults. */
export const SETTINGS_TABS = [
  "general",
  "workflow",
  "views",
  "labels",
  "components",
  "import",
  "handbook",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
