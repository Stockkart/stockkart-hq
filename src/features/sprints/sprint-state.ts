import { type CarryTarget } from "@/lib/sprints/schemas";
import { type SprintSummary } from "@/lib/sprints/views";

/**
 * Optimistic sprint changes (SPR-1/2, BLG-3): the sprint list and the backlog apply these at
 * once, inside the transition that runs the server action. When the action fails the
 * transition ends without new server data, so React drops the optimistic state: the
 * rollback. Pure, so the reducers are unit-tested without React.
 */
export type SprintChange =
  | { kind: "add"; sprint: SprintSummary }
  | {
      kind: "update";
      id: string;
      fields: Pick<SprintSummary, "name" | "goal" | "startDate" | "endDate">;
    }
  | { kind: "remove"; id: string }
  | { kind: "start"; id: string }
  | { kind: "complete"; id: string; carryTo: CarryTarget; targetId: string | null };

/** Display order: active, planned by start date, then closed (newest first). */
function ordered(list: SprintSummary[]): SprintSummary[] {
  const rank = { active: 0, planned: 1, closed: 2 } as const;
  return [...list].sort((a, b) => {
    if (a.state !== b.state) return rank[a.state] - rank[b.state];
    if (a.state === "planned") return (a.startDate ?? "~").localeCompare(b.startDate ?? "~");
    if (a.state === "closed") return (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0);
    return 0;
  });
}

export function applySprintChange(
  list: readonly SprintSummary[],
  change: SprintChange,
): SprintSummary[] {
  switch (change.kind) {
    case "add":
      return ordered([...list, change.sprint]);
    case "update":
      return ordered(
        list.map((sprint) => (sprint.id === change.id ? { ...sprint, ...change.fields } : sprint)),
      );
    case "remove":
      return list.filter((sprint) => sprint.id !== change.id);
    case "start":
      return ordered(
        list.map((sprint) =>
          sprint.id === change.id ? { ...sprint, state: "active" as const } : sprint,
        ),
      );
    case "complete": {
      const closing = list.find((sprint) => sprint.id === change.id);
      if (!closing) return [...list];
      const carried = closing.open;
      return ordered(
        list.map((sprint) => {
          if (sprint.id === change.id) {
            return {
              ...sprint,
              state: "closed" as const,
              closedAt: new Date(),
              open: { count: 0, points: 0 },
            };
          }
          if (change.carryTo === "next" && sprint.id === change.targetId) {
            return {
              ...sprint,
              open: {
                count: sprint.open.count + carried.count,
                points: sprint.open.points + carried.points,
              },
            };
          }
          return sprint;
        }),
      );
    }
  }
}

/** Where a sprint change moves issues: `[from sprint, to sprint or null]`, or null. */
export function issueMoveOf(
  change: SprintChange,
): { from: string; to: string | null; openOnly: boolean } | null {
  switch (change.kind) {
    case "remove":
      return { from: change.id, to: null, openOnly: false };
    case "complete":
      return {
        from: change.id,
        to: change.carryTo === "next" ? change.targetId : null,
        openOnly: true,
      };
    default:
      return null;
  }
}

/** The earliest planned sprint other than `exceptId` (the completion's "next sprint"). */
export function nextPlanned(
  sprints: readonly SprintSummary[],
  exceptId?: string,
): SprintSummary | null {
  return (
    ordered(sprints.filter((sprint) => sprint.state === "planned" && sprint.id !== exceptId))[0] ??
    null
  );
}
