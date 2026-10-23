import { type StatusCategory } from "@/lib/issues/constants";
import { type NamedOption } from "@/lib/issues/views";

/** Roadmap read models (RDM-1/RDM-2), passed from the page to the client. Plain data only. */

/** Live direct children of an epic, counted the way the progress bar needs them. */
export interface ChildTally {
  /** Every live child, Won't Do included. */
  total: number;
  /** Children in a done-category status other than Won't Do. */
  done: number;
  /** Children in Won't Do (left out of the progress). */
  wontDo: number;
  /** Story points of the children that count (Won't Do excluded). */
  points: number;
  /** Story points of the done children (Won't Do excluded). */
  donePoints: number;
  /** Children (Won't Do excluded) that have story points. */
  pointed: number;
}

export interface RoadmapEpic {
  id: string;
  key: string;
  number: number;
  title: string;
  status: { id: string; name: string; category: StatusCategory };
  assignee: NamedOption | null;
  component: NamedOption | null;
  /** ISO `YYYY-MM-DD`; the bar runs from `startDate` to `dueDate`, both included. */
  startDate: string | null;
  dueDate: string | null;
  children: ChildTally;
}

/** RDM-2: a stored `blocks` link between two live epics of the project. */
export interface RoadmapDependency {
  linkId: string;
  /** The blocking epic (`source blocks target`). */
  blockerId: string;
  blockedId: string;
}

export interface DateRange {
  start: string;
  end: string;
}
