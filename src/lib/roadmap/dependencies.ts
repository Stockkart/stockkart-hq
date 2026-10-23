import { daysBetween } from "@/lib/sprints/dates";

import { type RoadmapDependency } from "./views";

/**
 * RDM-2 dependencies between epics, from stored `blocks` links (`source blocks target`).
 * A dependency is a conflict when the blocker is due after the blocked epic starts: the
 * blocked work is planned to begin before what it waits for is finished. Ending on the very
 * day the blocked epic starts is a hand-off, not a conflict. Undated epics never conflict.
 */

export interface DependencyEnd {
  id: string;
  key: string;
  startDate: string | null;
  dueDate: string | null;
}

export interface ResolvedDependency {
  linkId: string;
  blocker: DependencyEnd;
  blocked: DependencyEnd;
  conflict: boolean;
  /** Days the blocker runs past the blocked epic's start (0 when no conflict). */
  overlapDays: number;
}

export function isConflict(blocker: DependencyEnd, blocked: DependencyEnd): boolean {
  if (!blocker.dueDate || !blocked.startDate) return false;
  return daysBetween(blocked.startDate, blocker.dueDate) > 0;
}

/** The dependencies whose epics are both in `epics` (e.g. the filtered roadmap), resolved. */
export function resolveDependencies(
  dependencies: readonly RoadmapDependency[],
  epics: readonly DependencyEnd[],
): ResolvedDependency[] {
  const byId = new Map(epics.map((epic) => [epic.id, epic]));
  return dependencies.flatMap((dependency) => {
    const blocker = byId.get(dependency.blockerId);
    const blocked = byId.get(dependency.blockedId);
    if (!blocker || !blocked) return [];
    const conflict = isConflict(blocker, blocked);
    return [
      {
        linkId: dependency.linkId,
        blocker,
        blocked,
        conflict,
        overlapDays:
          conflict && blocker.dueDate && blocked.startDate
            ? daysBetween(blocked.startDate, blocker.dueDate)
            : 0,
      },
    ];
  });
}
