import { type IncidentStatus } from "./constants";

/**
 * INC-1 lifecycle rules. Pure and isomorphic: the status control offers exactly these
 * moves, and the service re-checks them (the DB CHECKs are the last line).
 *
 *   investigating → mitigated (sets mitigated_at) → resolved (sets resolved_at)
 *   investigating → resolved  (mitigated_at may stay null)
 *   resolved → investigating  (reopen: clears resolved_at, keeps mitigated_at as history)
 */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  investigating: ["mitigated", "resolved"],
  mitigated: ["resolved"],
  resolved: ["investigating"],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

/** Times entered in the browser may be ahead of the server's clock by this much. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface IncidentTimes {
  startedAt: Date;
  mitigatedAt: Date | null;
  resolvedAt: Date | null;
}

/**
 * The `incidents_times_ordered` / `_status` CHECKs as messages: started ≤ mitigated ≤
 * resolved, nothing in the future, `resolved_at` exactly while resolved and `mitigated_at`
 * while mitigated. Null when the times are fine for that status.
 */
export function timeOrderError(
  status: IncidentStatus,
  times: IncidentTimes,
  now: Date = new Date(),
): string | null {
  const latest = now.getTime() + CLOCK_SKEW_MS;
  const { startedAt, mitigatedAt, resolvedAt } = times;
  if (startedAt.getTime() > latest) return "The start time is in the future";
  if (mitigatedAt && mitigatedAt.getTime() > latest) return "The mitigation time is in the future";
  if (resolvedAt && resolvedAt.getTime() > latest) return "The resolution time is in the future";
  if (status === "mitigated" && !mitigatedAt) return "A mitigated incident needs a mitigation time";
  if (status === "resolved" && !resolvedAt) return "A resolved incident needs a resolution time";
  if (status !== "resolved" && resolvedAt) return "Only a resolved incident has a resolution time";
  if (mitigatedAt && mitigatedAt < startedAt) return "Mitigated must be after the start";
  if (resolvedAt && resolvedAt < (mitigatedAt ?? startedAt)) {
    return mitigatedAt ? "Resolved must be after mitigated" : "Resolved must be after the start";
  }
  return null;
}

/**
 * The times after moving to `to` at `at`: mitigating sets `mitigatedAt`, resolving sets
 * `resolvedAt`, reopening clears `resolvedAt`.
 */
export function timesAfterTransition(
  times: IncidentTimes,
  to: IncidentStatus,
  at: Date,
): IncidentTimes {
  switch (to) {
    case "mitigated":
      return { ...times, mitigatedAt: at, resolvedAt: null };
    case "resolved":
      return { ...times, resolvedAt: at };
    case "investigating":
      return { ...times, resolvedAt: null };
  }
}

/** Open = not resolved; open incidents are pinned on top of the list. */
export const isOpenIncident = (status: IncidentStatus) => status !== "resolved";

/** "2h 15m", "3d 4h", "45m", "< 1m". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "< 1m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/** From start to resolution, or to `now` while the incident is open. */
export function incidentDurationMs(
  times: Pick<IncidentTimes, "startedAt" | "resolvedAt">,
  now: Date = new Date(),
): number {
  return (times.resolvedAt ?? now).getTime() - times.startedAt.getTime();
}

/** `INC-12` (any case) → 12; anything else → null. */
export function parseIncidentKey(value: string): number | null {
  const match = /^INC-([1-9]\d{0,8})$/i.exec(value.trim());
  return match?.[1] ? Number(match[1]) : null;
}

export function incidentsPath(projectKey: string): string {
  return `/${projectKey}/incidents`;
}

export function incidentPath(projectKey: string, number: number): string {
  return `/${projectKey}/incidents/INC-${number}`;
}
