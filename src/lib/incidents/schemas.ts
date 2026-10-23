import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TIMELINE_BODY_MAX,
  INCIDENT_TITLE_MAX,
} from "./constants";

/**
 * Zod input schemas of the incident actions (INC-1/2). Isomorphic; the server re-validates
 * everything, and the service checks the lifecycle and time order against the stored row.
 */

const id = z.uuid();
const projectKey = z.string().regex(PROJECT_KEY_PATTERN);

/** Plain-text summaries are bounded like timeline bodies. */
export const INCIDENT_SUMMARY_MAX = 10_000;
/** Affected services per incident (a project has few). */
export const INCIDENT_SERVICES_MAX = 50;

export const incidentTitle = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Title is required").max(INCIDENT_TITLE_MAX, "Title is too long"));

const summary = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().max(INCIDENT_SUMMARY_MAX, "Summary is too long"));

/** An ISO date-time from the browser (with offset), as a Date. */
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const serviceIds = z
  .array(id)
  .max(INCIDENT_SERVICES_MAX, `At most ${INCIDENT_SERVICES_MAX} services`)
  .transform((ids) => [...new Set(ids)]);

export const declareIncidentInput = z.object({
  projectKey,
  title: incidentTitle,
  severity: z.enum(INCIDENT_SEVERITIES),
  /** Defaults to now. */
  startedAt: instant.optional(),
  /** Defaults to the person declaring it. */
  commanderId: id.nullish(),
  serviceIds: serviceIds.default([]),
  summary: summary.default(""),
});

export const incidentIdInput = z.object({ incidentId: id });

export const setIncidentStatusInput = z.object({
  incidentId: id,
  /** The status the person saw; a concurrent change makes this a conflict. */
  from: z.enum(INCIDENT_STATUSES),
  to: z.enum(INCIDENT_STATUSES),
  /** When it happened (mitigated / resolved); defaults to now. */
  at: instant.optional(),
});

export const updateIncidentTimesInput = z.object({
  incidentId: id,
  startedAt: instant,
  mitigatedAt: instant.nullable(),
  resolvedAt: instant.nullable(),
});

/** Severity, commander, title, summary: only the fields sent change. */
export const updateIncidentInput = z.object({
  incidentId: id,
  title: incidentTitle.optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  commanderId: id.nullable().optional(),
  summary: summary.optional(),
});

export const setIncidentServicesInput = z.object({ incidentId: id, serviceIds });

const timelineBody = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(1, "Write something first")
      .max(INCIDENT_TIMELINE_BODY_MAX, "That entry is too long"),
  );

/** People add notes and actions; `status_change` entries come only from status changes. */
export const addTimelineEntryInput = z.object({
  incidentId: id,
  kind: z.enum(["note", "action"]),
  body: timelineBody,
  at: instant.optional(),
});

export const editTimelineEntryInput = z.object({
  entryId: id,
  body: timelineBody,
  /** Omitted: the time stays as stored (the form only sends it when it was changed). */
  at: instant.optional(),
});

export const timelineEntryIdInput = z.object({ entryId: id });

export const linkFollowUpInput = z.object({
  incidentId: id,
  issueKey: z.string().trim().toUpperCase().max(20),
});

export const unlinkFollowUpInput = z.object({ incidentId: id, linkId: id });

export const incidentListFilterInput = z.object({
  status: z.array(z.enum(INCIDENT_STATUSES)).default([]),
  severity: z.array(z.enum(INCIDENT_SEVERITIES)).default([]),
  /** A service slug. */
  service: z.string().max(64).nullable().default(null),
});
export type IncidentListFilter = z.output<typeof incidentListFilterInput>;
