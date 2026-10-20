import { type SprintState } from "./constants";

/** Sprint read models passed from server components to client components. Plain data only. */

/** A sprint in a picker (issue side panel, quick create): planned and active ones only. */
export interface SprintOption {
  id: string;
  name: string;
  state: SprintState;
}

/** Live issues of a sprint by how they count (see `statusKind`). */
export interface SprintTally {
  count: number;
  points: number;
}

export interface SprintSummary {
  id: string;
  name: string;
  goal: string | null;
  /** ISO `YYYY-MM-DD`. */
  startDate: string | null;
  endDate: string | null;
  state: SprintState;
  closedAt: Date | null;
  open: SprintTally;
  done: SprintTally;
  wontDo: SprintTally;
}

/** One x position of the burndown chart (SPR-3). Null values: a day still to come. */
export interface BurndownPoint {
  /** `start`, or the ISO date whose end-of-day state this is. */
  key: string;
  label: string;
  /** Points not yet in a done-category status. */
  remaining: number | null;
  /** Points of the sprint's issues, Won't Do excluded (remaining + completed). */
  scope: number | null;
  /** Points in a done (not Won't Do) status. */
  completed: number | null;
  /** The straight line from the committed points to zero on the last day. */
  ideal: number;
}

export interface Burndown {
  /** Points committed when the sprint started. */
  committed: number;
  points: BurndownPoint[];
}

/** One bar of the velocity chart (SPR-4). */
export interface VelocityBar {
  sprintId: string;
  name: string;
  completed: number;
}
