import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

import {
  BOARD_SCOPES,
  BOARD_SPRINT_PARAM,
  type BoardScope,
  SPRINT_GOAL_MAX,
  SPRINT_MAX_DAYS,
  SPRINT_NAME_MAX,
} from "./constants";
import { daysBetween } from "./dates";

/**
 * Zod input schemas for the sprint actions (SPR-1, SPR-2, BLG-3). Isomorphic: the dialogs
 * use them for hints, and the server always re-validates.
 */

const id = z.uuid();
const isoDate = z.iso.date();
const name = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Name is required").max(SPRINT_NAME_MAX, "Name is too long"));
/** Empty means no goal. */
const goal = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || null)
  .pipe(z.string().max(SPRINT_GOAL_MAX, "Goal is too long").nullable());

const sprintFields = z.object({ name, goal, startDate: isoDate, endDate: isoDate });

/** End on or after start, and not absurdly long (bounds the burndown series). */
function checkDates(value: { startDate: string; endDate: string }, ctx: z.RefinementCtx) {
  const days = daysBetween(value.startDate, value.endDate);
  if (days < 0) {
    ctx.addIssue({ code: "custom", message: "End date is before the start", path: ["endDate"] });
  } else if (days + 1 > SPRINT_MAX_DAYS) {
    ctx.addIssue({
      code: "custom",
      message: `A sprint lasts at most ${SPRINT_MAX_DAYS} days`,
      path: ["endDate"],
    });
  }
}

export const createSprintInput = sprintFields
  .extend({ projectKey: z.string().regex(PROJECT_KEY_PATTERN) })
  .superRefine(checkDates);
export type CreateSprintInput = z.input<typeof createSprintInput>;

/** The create/edit dialog's own check (same rules, no ids). */
export const sprintFormInput = sprintFields.superRefine(checkDates);
export type SprintFormValues = z.input<typeof sprintFormInput>;

/** Only planned sprints are edited (SPR-1). */
export const updateSprintInput = sprintFields.extend({ sprintId: id }).superRefine(checkDates);
export type UpdateSprintInput = z.input<typeof updateSprintInput>;

export const sprintIdInput = z.object({ sprintId: id });

/** SPR-2: where the open issues of a completed sprint go. */
export const CARRY_TARGETS = ["next", "backlog"] as const;
export type CarryTarget = (typeof CARRY_TARGETS)[number];
export const completeSprintInput = z.object({ sprintId: id, carryTo: z.enum(CARRY_TARGETS) });

/**
 * BLG-3: put an issue into a sprint (`sprintId`) or the backlog (null). With `afterIssueId`
 * (null = top) it is also re-ranked, as `moveIssueInput`; without it it keeps its rank.
 */
export const moveIssueToSprintInput = z
  .object({ issueId: id, sprintId: id.nullable(), afterIssueId: id.nullable().optional() })
  .refine((value) => value.issueId !== value.afterIssueId, "An issue cannot follow itself");

/**
 * BRD-3: what the board shows. `scope: "all"` is every open issue; `scope: "sprint"` is one
 * sprint, `sprintId` (a planned or the active one) or, when null, the active sprint.
 */
export interface BoardSelection {
  scope: BoardScope;
  sprintId: string | null;
}

/** The default: the active sprint (or every open issue when no sprint is active). */
export const DEFAULT_BOARD_SELECTION: BoardSelection = { scope: "sprint", sprintId: null };

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function firstParam(params: RawParams, name: string): string | undefined {
  const raw = params instanceof URLSearchParams ? params.get(name) : params[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? undefined;
}

/**
 * BRD-3 board selection from the URL: `?scope=all`, `?sprint=<id>`, or neither (the
 * default). `scope=all` wins over a sprint; anything unparsable falls back to the default.
 * Whether the sprint exists (and is open, in this project) is the page's check.
 */
export function parseBoardSelection(params: RawParams): BoardSelection {
  const scope = z.enum(BOARD_SCOPES).safeParse(firstParam(params, "scope"));
  if (scope.success && scope.data === "all") return { scope: "all", sprintId: null };
  const sprint = id.safeParse(firstParam(params, BOARD_SPRINT_PARAM));
  return { scope: "sprint", sprintId: sprint.success ? sprint.data : null };
}

/** The URL params of a selection (undefined = not written), for `boardViewQuery`. */
export function boardSelectionParams(
  selection: BoardSelection,
): Record<string, string | undefined> {
  return {
    scope: selection.scope === "all" ? "all" : undefined,
    [BOARD_SPRINT_PARAM]:
      selection.scope === "sprint" ? (selection.sprintId ?? undefined) : undefined,
  };
}

/**
 * The board URL for a selection; the default is written as the plain URL. `view` (BRD-6)
 * adds the type and column params, as `boardViewQuery` writes them (its own scope and
 * sprint params never override `selection`).
 */
export function boardHref(projectKey: string, selection: BoardSelection, view?: URLSearchParams) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(boardSelectionParams(selection))) {
    if (value) params.set(name, value);
  }
  for (const [name, value] of view ?? []) {
    if (name !== "scope" && name !== BOARD_SPRINT_PARAM) params.set(name, value);
  }
  const query = params.toString();
  return query ? `/${projectKey}/board?${query}` : `/${projectKey}/board`;
}
