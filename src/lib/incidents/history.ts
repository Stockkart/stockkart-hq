import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUSES,
  type IncidentSeverity,
  type IncidentStatus,
} from "./constants";
import { formatDateTime } from "./datetime";
import { type IncidentActivityView } from "./views";

/**
 * The incident's History list (INC-1): one line per `activity` row, without the actor.
 * Activity stores raw values (ids, enum values, ISO times); names are resolved here from
 * what the page already has, so a renamed user or service shows its current name.
 */

export interface HistoryNames {
  users: ReadonlyMap<string, string>;
  services: ReadonlyMap<string, string>;
}

const isSeverity = (value: string): value is IncidentSeverity =>
  (INCIDENT_SEVERITIES as readonly string[]).includes(value);
const isStatus = (value: string): value is IncidentStatus =>
  (INCIDENT_STATUSES as readonly string[]).includes(value);

function shown(field: string | null, value: string | null, names: HistoryNames): string {
  if (value === null || value === "") return "none";
  switch (field) {
    case "severity":
      return isSeverity(value) ? INCIDENT_SEVERITY_LABELS[value] : value;
    case "status":
      return isStatus(value) ? INCIDENT_STATUS_LABELS[value] : value;
    case "commanderId":
      return names.users.get(value) ?? "a former user";
    case "services":
      return value
        .split(",")
        .map((id) => names.services.get(id) ?? "a deleted service")
        .join(", ");
    case "startedAt":
    case "mitigatedAt":
    case "resolvedAt":
    case "timeline.at": {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : formatDateTime(date);
    }
    default:
      return value.length > 80 ? `${value.slice(0, 79)}…` : value;
  }
}

const FIELD_LABELS: Record<string, string> = {
  title: "the title",
  severity: "the severity",
  status: "the status",
  summary: "the summary",
  commanderId: "the commander",
  services: "the affected services",
  startedAt: "the start time",
  mitigatedAt: "the mitigation time",
  resolvedAt: "the resolution time",
  postmortemDocId: "the postmortem",
  "timeline.body": "a timeline entry",
  "timeline.at": "a timeline entry's time",
};

export function incidentActivityText(entry: IncidentActivityView, names: HistoryNames): string {
  const field = entry.field ? (FIELD_LABELS[entry.field] ?? entry.field) : null;
  switch (entry.action) {
    case "created":
      return "declared the incident";
    case "linked":
      return "linked a follow-up issue";
    case "unlinked":
      return "unlinked a follow-up issue";
    case "timeline_deleted":
      return "deleted a timeline entry";
    case "timeline_edited":
      return entry.field === "timeline.at"
        ? `moved a timeline entry to ${shown(entry.field, entry.toValue, names)}`
        : "edited a timeline entry";
    case "updated":
      if (entry.field === "postmortemDocId") return "created the postmortem";
      if (entry.field === "summary" || entry.field === "title") return `changed ${field}`;
      return `changed ${field ?? "a field"} from ${shown(entry.field, entry.fromValue, names)} to ${shown(entry.field, entry.toValue, names)}`;
    default:
      return entry.action;
  }
}
