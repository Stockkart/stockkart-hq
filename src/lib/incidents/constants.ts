/**
 * Incident vocabulary (SPEC §4.14 INC-1/INC-2) shared by the schema enums, server code and
 * UI. Isomorphic: safe to import from client components. Defined by the P2 foundation
 * (migration 0005) so the incidents slice needs no migration.
 */

/** INC-1. SEV1 is the worst. Order is the order shown in pickers. */
export const INCIDENT_SEVERITIES = ["sev1", "sev2", "sev3"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  sev1: "SEV1",
  sev2: "SEV2",
  sev3: "SEV3",
};

/**
 * INC-1 lifecycle. `incidents.resolved_at` is set exactly when the status is `resolved`
 * (a CHECK enforces it), so reopening an incident must clear it. `mitigated` needs
 * `mitigated_at`; going straight to `resolved` may leave it null.
 */
export const INCIDENT_STATUSES = ["investigating", "mitigated", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: "Investigating",
  mitigated: "Mitigated",
  resolved: "Resolved",
};

/** `incident_timeline.kind`: a free note, a status change, or an action taken. */
export const INCIDENT_TIMELINE_KINDS = ["note", "status_change", "action"] as const;
export type IncidentTimelineKind = (typeof INCIDENT_TIMELINE_KINDS)[number];

/** Length limits, also CHECKs on `incidents.title` and `incident_timeline.body`. */
export const INCIDENT_TITLE_MAX = 200;
export const INCIDENT_TIMELINE_BODY_MAX = 10_000;

/** Incident keys read `INC-<number>`, numbered per project from `projects.incident_counter`. */
export const INCIDENT_KEY_PREFIX = "INC";

export function formatIncidentKey(number: number): string {
  return `${INCIDENT_KEY_PREFIX}-${number}`;
}
