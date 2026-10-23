import { type ChildTally } from "./views";

/**
 * RDM-1 progress of an epic: the share of its children's story points that are in a
 * done-category status. Won't Do counts in neither the done points nor the total (like
 * velocity, SPR-4), so dropping work never looks like progress or like work left.
 *
 * Without any points among the counted children, the share of done children is shown
 * instead (`basis: "issues"`), so an unestimated epic still shows how far it is. With no
 * counted children at all (none, or only Won't Do) there is no progress: `percent` is null.
 */
export interface EpicProgress {
  /** 0…100, rounded down so "100%" means everything is done; null when nothing counts. */
  percent: number | null;
  basis: "points" | "issues" | "none";
  /** Short text for the bar, e.g. "8 / 13 pts" or "2 / 5 issues". */
  label: string;
}

const share = (part: number, whole: number) => Math.floor((part / whole) * 100);

export function epicProgress(children: ChildTally): EpicProgress {
  const counted = children.total - children.wontDo;
  if (counted <= 0) {
    return {
      percent: null,
      basis: "none",
      label: children.total === 0 ? "No child issues" : "Only Won't Do children",
    };
  }
  if (children.points > 0) {
    return {
      percent: share(children.donePoints, children.points),
      basis: "points",
      label: `${children.donePoints} / ${children.points} pts`,
    };
  }
  return {
    percent: share(children.done, counted),
    basis: "issues",
    label: `${children.done} / ${counted} ${counted === 1 ? "issue" : "issues"}`,
  };
}
