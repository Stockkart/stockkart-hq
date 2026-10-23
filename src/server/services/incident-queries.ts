import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import {
  formatIncidentKey,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TIMELINE_KINDS,
} from "@/lib/incidents/constants";
import { incidentPath } from "@/lib/incidents/rules";
import { type IncidentListFilter } from "@/lib/incidents/schemas";
import {
  type FollowUpView,
  type IncidentActivityView,
  type IncidentDetail,
  type IncidentRefView,
  type IncidentRow,
  type IncidentServiceRef,
  type TimelineEntryView,
} from "@/lib/incidents/views";
import { STATUS_CATEGORIES } from "@/lib/issues/constants";
import { formatIssueKey } from "@/lib/issues/keys";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { type IdRef, rowsOf } from "./sql";

/** The list shows at most this many incidents (open ones always come first). */
export const INCIDENT_LIST_LIMIT = 200;

/** The id of the live incident with this number in that project; NULL when there is none. */
export const incidentIdByNumber = (projectId: IdRef, number: number): SQL =>
  sql`(SELECT id FROM incidents WHERE project_id = ${projectId}::uuid AND number = ${number}
    AND deleted_at IS NULL)`;

const serviceRef = z.object({ id: z.string(), slug: z.string(), name: z.string() });

/** An incident's live affected services as one json column (by name). */
const servicesJson = sql`COALESCE((
  SELECT json_agg(json_build_object('id', s.id, 'slug', s.slug, 'name', s.name)
    ORDER BY s.position, s.id)
  FROM incident_services isv JOIN services s ON s.id = isv.service_id AND s.deleted_at IS NULL
  WHERE isv.incident_id = i.id
), '[]'::json)`;

const rowColumns = sql`i.id::text, i.number, i.title, i.severity::text, i.status::text,
  i.started_at, i.mitigated_at, i.resolved_at, i.commander_id::text, u.name AS commander_name,
  ${servicesJson} AS services`;

const row = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(INCIDENT_STATUSES),
  started_at: z.coerce.date(),
  mitigated_at: z.coerce.date().nullable(),
  resolved_at: z.coerce.date().nullable(),
  commander_id: z.string().nullable(),
  commander_name: z.string().nullable(),
  services: z.array(serviceRef),
});

function toRow(value: z.infer<typeof row>): IncidentRow {
  return {
    id: value.id,
    number: value.number,
    key: formatIncidentKey(value.number),
    title: value.title,
    severity: value.severity,
    status: value.status,
    startedAt: value.started_at,
    mitigatedAt: value.mitigated_at,
    resolvedAt: value.resolved_at,
    commanderId: value.commander_id,
    commanderName: value.commander_name,
    services: value.services,
  };
}

/**
 * Reads of the incident pages (INC-1/2). Every query takes ids or `IdRef` subqueries, so a
 * page starts them all together: ONE round trip on Neon (README "Performance").
 */
export function createIncidentQueries(
  db: AppDatabase,
  { read = directRead }: { read?: Read } = {},
) {
  return {
    /**
     * The list: open incidents pinned on top, then newest first. Filters (URL params)
     * combine with AND; values within one filter with OR.
     */
    async listIncidents(projectId: IdRef, filter: IncidentListFilter): Promise<IncidentRow[]> {
      const statuses = sql`${JSON.stringify(filter.status)}::jsonb`;
      const severities = sql`${JSON.stringify(filter.severity)}::jsonb`;
      const result = await read(
        db.execute(sql`
          SELECT ${rowColumns}
          FROM incidents i LEFT JOIN users u ON u.id = i.commander_id
          WHERE i.project_id = ${projectId}::uuid AND i.deleted_at IS NULL
            AND (jsonb_array_length(${statuses}) = 0
              OR i.status::text IN (SELECT jsonb_array_elements_text(${statuses})))
            AND (jsonb_array_length(${severities}) = 0
              OR i.severity::text IN (SELECT jsonb_array_elements_text(${severities})))
            AND (${filter.service}::text IS NULL OR EXISTS (
              SELECT 1 FROM incident_services isv
              JOIN services s ON s.id = isv.service_id AND s.deleted_at IS NULL
              WHERE isv.incident_id = i.id AND s.slug = ${filter.service}::text))
          ORDER BY (i.status = 'resolved'), i.started_at DESC, i.number DESC
          LIMIT ${INCIDENT_LIST_LIMIT}
        `),
      );
      return rowsOf(result, row).map(toRow);
    },

    async getIncident(projectId: IdRef, number: number): Promise<IncidentDetail | null> {
      const result = await read(
        db.execute(sql`
          SELECT ${rowColumns}, i.summary, i.created_at,
            d.id::text AS postmortem_id, d.title AS postmortem_title
          FROM incidents i
          LEFT JOIN users u ON u.id = i.commander_id
          LEFT JOIN docs d ON d.id = i.postmortem_doc_id AND d.deleted_at IS NULL
          WHERE i.project_id = ${projectId}::uuid AND i.number = ${number}
            AND i.deleted_at IS NULL
        `),
      );
      const [value] = rowsOf(
        result,
        row.extend({
          summary: z.string(),
          created_at: z.coerce.date(),
          postmortem_id: z.string().nullable(),
          postmortem_title: z.string().nullable(),
        }),
      );
      if (!value) return null;
      return {
        ...toRow(value),
        summary: value.summary,
        createdAt: value.created_at,
        postmortem:
          value.postmortem_id && value.postmortem_title !== null
            ? { id: value.postmortem_id, title: value.postmortem_title }
            : null,
      };
    },

    /** INC-1 timeline in `at` order (ties in the order written). */
    async timeline(incidentId: IdRef): Promise<TimelineEntryView[]> {
      const result = await read(
        db.execute(sql`
          SELECT t.id::text, t.at, t.kind::text, t.body, t.author_id::text,
            u.name AS author_name
          FROM incident_timeline t LEFT JOIN users u ON u.id = t.author_id
          WHERE t.incident_id = ${incidentId}::uuid
          ORDER BY t.at, t.created_at, t.id
        `),
      );
      return rowsOf(
        result,
        z.object({
          id: z.string(),
          at: z.coerce.date(),
          kind: z.enum(INCIDENT_TIMELINE_KINDS),
          body: z.string(),
          author_id: z.string().nullable(),
          author_name: z.string().nullable(),
        }),
      ).map((entry) => ({
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        body: entry.body,
        authorId: entry.author_id,
        authorName: entry.author_name,
      }));
    },

    /** INC-2 follow-up issues (`entity_links` incident → issue) with their status. */
    async followUps(incidentId: IdRef): Promise<FollowUpView[]> {
      const result = await read(
        db.execute(sql`
          SELECT l.id::text AS link_id, i.id::text AS issue_id, i.number, i.title,
            p.key AS project_key, st.name AS status_name, st.category::text AS status_category
          FROM entity_links l
          JOIN issues i ON i.id = l.to_id AND i.deleted_at IS NULL
          JOIN projects p ON p.id = i.project_id
          JOIN statuses st ON st.id = i.status_id
          WHERE l.from_type = 'incident' AND l.from_id = ${incidentId}::uuid
            AND l.to_type = 'issue' AND l.origin = 'manual'
          ORDER BY i.number
        `),
      );
      return rowsOf(
        result,
        z.object({
          link_id: z.string(),
          issue_id: z.string(),
          number: z.number(),
          title: z.string(),
          project_key: z.string(),
          status_name: z.string(),
          status_category: z.enum(STATUS_CATEGORIES),
        }),
      ).map((value) => ({
        linkId: value.link_id,
        issueId: value.issue_id,
        key: formatIssueKey(value.project_key, value.number),
        title: value.title,
        status: { name: value.status_name, category: value.status_category },
      }));
    },

    /** The incident's history, newest first. */
    async activity(incidentId: IdRef): Promise<IncidentActivityView[]> {
      const result = await read(
        db.execute(sql`
          SELECT a.id::text, u.name AS actor_name, a.action, a.field, a.from_value,
            a.to_value, a.created_at
          FROM activity a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.entity_type = 'incident' AND a.entity_id = ${incidentId}::uuid
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 100
        `),
      );
      return rowsOf(
        result,
        z.object({
          id: z.string(),
          actor_name: z.string().nullable(),
          action: z.string(),
          field: z.string().nullable(),
          from_value: z.string().nullable(),
          to_value: z.string().nullable(),
          created_at: z.coerce.date(),
        }),
      ).map((value) => ({
        id: value.id,
        actorName: value.actor_name,
        action: value.action,
        field: value.field,
        fromValue: value.from_value,
        toValue: value.to_value,
        createdAt: value.created_at,
      }));
    },

    /** Affected-services pickers and the list's service filter: live services in order. */
    async serviceOptions(projectId: IdRef): Promise<IncidentServiceRef[]> {
      const result = await read(
        db.execute(sql`
          SELECT id::text, slug, name FROM services
          WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
          ORDER BY position, id
        `),
      );
      return rowsOf(result, serviceRef);
    },

    /** "From incident INC-n" on an issue's Links panel. */
    async incidentsLinkingTo(issueId: IdRef): Promise<IncidentRefView[]> {
      const result = await read(
        db.execute(sql`
          SELECT i.id::text, i.number, i.title, p.key AS project_key
          FROM entity_links l
          JOIN incidents i ON i.id = l.from_id AND i.deleted_at IS NULL
          JOIN projects p ON p.id = i.project_id
          WHERE l.to_type = 'issue' AND l.to_id = ${issueId}::uuid
            AND l.from_type = 'incident' AND l.origin = 'manual'
          ORDER BY i.number
        `),
      );
      return rowsOf(
        result,
        z.object({
          id: z.string(),
          number: z.number(),
          title: z.string(),
          project_key: z.string(),
        }),
      ).map((value) => ({
        id: value.id,
        key: formatIncidentKey(value.number),
        title: value.title,
        href: incidentPath(value.project_key, value.number),
      }));
    },
  };
}

export type IncidentQueries = ReturnType<typeof createIncidentQueries>;
