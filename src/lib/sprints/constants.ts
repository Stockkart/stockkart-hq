/**
 * Sprint vocabulary (SPEC §4.7) shared by the schema readers, server code and UI. Isomorphic.
 */

export const SPRINT_STATES = ["planned", "active", "closed"] as const;
export type SprintState = (typeof SPRINT_STATES)[number];

/**
 * §4.4: "Won't Do" is a done-category status that is excluded from velocity. Statuses only
 * carry a category, so it is recognised by its (seeded) name. Burndown treats it as scope
 * removed from the sprint, never as completed work.
 */
export const WONT_DO_STATUS_NAME = "Won't Do";

/** How a status counts for burndown and velocity (SPR-3, SPR-4). */
export type StatusKind = "open" | "done" | "wont_do";

export function statusKind(status: { category: string; name: string }): StatusKind {
  if (status.category !== "done") return "open";
  return status.name === WONT_DO_STATUS_NAME ? "wont_do" : "done";
}

/** SPR-4: the velocity chart shows this many closed sprints. */
export const VELOCITY_SPRINTS = 6;

/** Longest sprint accepted (bounds the per-day burndown series). */
export const SPRINT_MAX_DAYS = 90;

export const SPRINT_NAME_MAX = 80;
export const SPRINT_GOAL_MAX = 500;

/** Board scope URL param (BRD-3): `?scope=all` shows every open issue. */
export const BOARD_SCOPES = ["sprint", "all"] as const;
export type BoardScope = (typeof BOARD_SCOPES)[number];

/** Activity actions on `entity_type = 'sprint'` rows. */
export const SPRINT_ACTIONS = {
  created: "sprint_created",
  updated: "sprint_updated",
  deleted: "sprint_deleted",
  started: "sprint_started",
  completed: "sprint_completed",
} as const;
