import { type ReleaseSummary } from "@/lib/releases/views";

/**
 * REL-1 optimistic updates of the release list: each confirmed action applies its change at
 * once inside the transition that runs the server action (`useOptimistic`); the action's
 * re-render brings the server's state, and a refused action ends the transition without
 * new data, which rolls the change back. Pure, so it is unit-tested.
 */
export type ReleaseChange =
  | { kind: "add"; release: ReleaseSummary }
  | {
      kind: "update";
      id: string;
      fields: Pick<ReleaseSummary, "name" | "releaseDate" | "description">;
    }
  | { kind: "remove"; id: string }
  | { kind: "release"; id: string; at: Date; moveOpenTo: string | null }
  | { kind: "reopen"; id: string };

/** REL-1 order: unreleased by target date (none last), then released, newest first. */
export function sortReleases(releases: readonly ReleaseSummary[]): ReleaseSummary[] {
  const rank = (release: ReleaseSummary) => (release.state === "released" ? 1 : 0);
  return [...releases].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.state === "unreleased") {
      if (a.releaseDate !== b.releaseDate) {
        if (a.releaseDate === null) return 1;
        if (b.releaseDate === null) return -1;
        return a.releaseDate < b.releaseDate ? -1 : 1;
      }
    } else {
      const at = (release: ReleaseSummary) => release.releasedAt?.getTime() ?? 0;
      if (at(a) !== at(b)) return at(b) - at(a);
    }
    return a.name.localeCompare(b.name);
  });
}

export function applyReleaseChange(
  releases: readonly ReleaseSummary[],
  change: ReleaseChange,
): ReleaseSummary[] {
  switch (change.kind) {
    case "add":
      return sortReleases([...releases, change.release]);
    case "update":
      return sortReleases(
        releases.map((release) =>
          release.id === change.id ? { ...release, ...change.fields } : release,
        ),
      );
    case "remove":
      return releases.filter((release) => release.id !== change.id);
    case "release": {
      const source = releases.find((release) => release.id === change.id);
      // Open issues moved to another release take their tally with them.
      const open = source
        ? {
            count: source.total.count - source.done.count,
            points: source.total.points - source.done.points,
          }
        : { count: 0, points: 0 };
      return sortReleases(
        releases.map((release) => {
          if (release.id === change.id) {
            return {
              ...release,
              state: "released" as const,
              releasedAt: change.at,
              total: change.moveOpenTo ? release.done : release.total,
            };
          }
          if (release.id === change.moveOpenTo) {
            return {
              ...release,
              total: {
                count: release.total.count + open.count,
                points: release.total.points + open.points,
              },
            };
          }
          return release;
        }),
      );
    }
    case "reopen":
      return sortReleases(
        releases.map((release) =>
          release.id === change.id
            ? { ...release, state: "unreleased" as const, releasedAt: null }
            : release,
        ),
      );
  }
}
