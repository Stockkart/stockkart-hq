import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import {
  formatIncidentKey,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUSES,
  INCIDENT_TIMELINE_KINDS,
  type IncidentStatus,
} from "@/lib/incidents/constants";
import {
  buildPostmortem,
  POSTMORTEMS_PARENT_TITLE,
  postmortemTitle,
} from "@/lib/incidents/postmortem";
import {
  canTransition,
  CLOCK_SKEW_MS,
  type IncidentTimes,
  timeOrderError,
  timesAfterTransition,
} from "@/lib/incidents/rules";
import {
  type addTimelineEntryInput,
  type declareIncidentInput,
  type editTimelineEntryInput,
  type linkFollowUpInput,
  type setIncidentServicesInput,
  type setIncidentStatusInput,
  type updateIncidentInput,
  type updateIncidentTimesInput,
} from "@/lib/incidents/schemas";
import { formatIssueKey, parseIssueKey } from "@/lib/issues/keys";
import { emptyDoc, extractPlainText, type RichTextDoc, richTextDocSchema } from "@/lib/rich-text";
import { BUILT_IN_DOC_TEMPLATES } from "@/lib/templates/doc-templates";
import { directRead, type Read } from "@/server/db/read-batch";
import { issues, projects, users } from "@/server/db/schema";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, forbidden, invalid, notFound, pgErrorInfo, type ServiceError } from "./errors";
import { allocateIncidentNumber } from "./incident-numbers";
import { notificationsInsert } from "./notifications";
import { docRefs, jsonbOrNull, mentionSyncCtes, rowsOf, uuidOrNull } from "./sql";

export type DeclareIncidentData = z.output<typeof declareIncidentInput>;
export type SetIncidentStatusData = z.output<typeof setIncidentStatusInput>;
export type UpdateIncidentTimesData = z.output<typeof updateIncidentTimesInput>;
export type UpdateIncidentData = z.output<typeof updateIncidentInput>;
export type SetIncidentServicesData = z.output<typeof setIncidentServicesInput>;
export type AddTimelineEntryData = z.output<typeof addTimelineEntryInput>;
export type EditTimelineEntryData = z.output<typeof editTimelineEntryInput>;
export type LinkFollowUpData = z.output<typeof linkFollowUpInput>;

export interface DeclaredIncident {
  id: string;
  number: number;
  key: string;
}

export interface IncidentServiceOptions {
  runAtomic: RunAtomic;
  read?: Read;
}

/** Postgres `check_violation`: a time-order or status/timestamp CHECK refused the write. */
const CHECK_VIOLATION = "23514";

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const tsOrNull = (date: Date | null) => sql`${iso(date)}::timestamptz`;

/** `activity.from_value` of a timestamp column: ISO 8601 text, like the JS side writes. */
const isoText = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const currentRow = z.object({
  id: z.string(),
  project_id: z.string(),
  number: z.number(),
  status: z.enum(INCIDENT_STATUSES),
  started_at: z.coerce.date(),
  mitigated_at: z.coerce.date().nullable(),
  resolved_at: z.coerce.date().nullable(),
});

/** Maps a CHECK violation (a race the pre-checks could not see) to a readable error. */
async function withTimeChecks<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (pgErrorInfo(error)?.code === CHECK_VIOLATION) {
      throw invalid("The times must be in order: started ≤ mitigated ≤ resolved");
    }
    throw error;
  }
}

/** The "Incident declared" / status change line of the timeline. */
function statusChangeBody(from: IncidentStatus, to: IncidentStatus): string {
  if (from === "resolved" && to === "investigating") return "Reopened: back to Investigating";
  return `Status: ${INCIDENT_STATUS_LABELS[from]} → ${INCIDENT_STATUS_LABELS[to]}`;
}

/**
 * Incidents (INC-1/2): declare, the status lifecycle, times, fields, affected services,
 * the timeline, follow-up issues and the postmortem. Every write is one statement (or a
 * `RunAtomic` when a later step must see the database after a lock) and logs an
 * `activity` row per changed field in the same statement.
 */
export function createIncidentService(db: AppDatabase, options: IncidentServiceOptions) {
  const read = options.read ?? directRead;

  async function projectByKey(key: string) {
    const [project] = await read(
      db
        .select({ id: projects.id, key: projects.key })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1),
    );
    if (!project) throw notFound(`Project ${key}`);
    return project;
  }

  async function checkUser(userId: string | null | undefined) {
    if (!userId) return;
    const [row] = await read(
      db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1),
    );
    if (!row) throw notFound("Commander");
  }

  /** Every id must be a live service of the project (the app's same-project rule). */
  async function checkServices(projectId: SQL | string, serviceIds: readonly string[]) {
    if (serviceIds.length === 0) return;
    const result = await read(
      db.execute(sql`
        SELECT count(*)::int AS found FROM services
        WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(
            ${JSON.stringify(serviceIds)}::jsonb))
      `),
    );
    const [row] = rowsOf(result, z.object({ found: z.number() }));
    if ((row?.found ?? 0) !== serviceIds.length) throw notFound("Service");
  }

  async function current(incidentId: string) {
    const result = await read(
      db.execute(sql`
        SELECT id::text, project_id::text, number, status::text, started_at, mitigated_at,
          resolved_at
        FROM incidents WHERE id = ${incidentId}::uuid AND deleted_at IS NULL
      `),
    );
    const [row] = rowsOf(result, currentRow);
    if (!row) throw notFound("Incident");
    return row;
  }

  function checkNotFuture(at: Date) {
    if (at.getTime() > Date.now() + CLOCK_SKEW_MS) throw invalid("That time is in the future");
  }

  async function issueByKey(issueKey: string) {
    const ref = parseIssueKey(issueKey);
    if (!ref) throw invalid("Enter an issue key such as STK-12");
    const [issue] = await read(
      db
        .select({ id: issues.id })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(
          and(
            eq(projects.key, ref.projectKey),
            eq(issues.number, ref.number),
            isNull(issues.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!issue) throw notFound(formatIssueKey(ref.projectKey, ref.number));
    return issue;
  }

  /**
   * Notifies `commander` (a SQL uuid expression over `source`'s rows) that they lead the
   * incident: a CTE body. The actor is never notified about themselves; `eventKey` makes a
   * retry insert nothing.
   */
  function commanderNotification(source: SQL): SQL {
    return sql`
      SELECT n.commander_id AS user_id, 'incident_commander'::text AS type,
        'incident'::text AS entity_type, n.incident_id AS entity_id, n.event_key::text,
        jsonb_build_object('incidentKey', 'INC-' || n.number) AS meta
      FROM (${source}) AS n`;
  }

  return {
    /**
     * "Declare incident": INC-n from `allocateIncidentNumber`, and in the SAME statement
     * the affected services, the first timeline entry ("Incident declared") and the
     * commander's `incident_commander` notification (not when they declared it).
     */
    async declareIncident(actorId: string, input: DeclareIncidentData): Promise<DeclaredIncident> {
      const commanderId = input.commanderId === undefined ? actorId : input.commanderId;
      const startedAt = input.startedAt ?? new Date();
      checkNotFuture(startedAt);
      const [project] = await Promise.all([
        projectByKey(input.projectKey),
        checkUser(commanderId),
        checkServices(
          sql`(SELECT id FROM projects WHERE key = ${input.projectKey})`,
          input.serviceIds,
        ),
      ]);
      const id = crypto.randomUUID();
      const serviceIds = JSON.stringify(input.serviceIds);
      const extra = sql`
        services_added AS (
          INSERT INTO incident_services (incident_id, service_id)
          SELECT inserted.id, s.id FROM inserted, services s
          WHERE s.project_id = ${project.id}::uuid AND s.deleted_at IS NULL
            AND s.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${serviceIds}::jsonb))
        ),
        first_entry AS (
          -- At the start time, so the timeline opens with it even when declared later.
          INSERT INTO incident_timeline (incident_id, at, author_id, kind, body)
          SELECT inserted.id, ${startedAt.toISOString()}::timestamptz, ${actorId}::uuid,
            'status_change', 'Incident declared'
          FROM inserted
        ),
        commander_notified AS (
          ${notificationsInsert({
            actorId,
            source: commanderNotification(sql`
              SELECT ${uuidOrNull(commanderId)} AS commander_id, inserted.id AS incident_id,
                inserted.number, 'incident_commander:' || inserted.id::text AS event_key
              FROM inserted`),
          })}
        )`;
      const allocated = await allocateIncidentNumber(
        db,
        actorId,
        {
          id,
          projectId: project.id,
          title: input.title,
          severity: input.severity,
          startedAt,
          commanderId,
          summary: input.summary,
        },
        extra,
      );
      return { ...allocated, key: formatIncidentKey(allocated.number) };
    },

    /**
     * The status control. Allowed moves are `INCIDENT_TRANSITIONS`; mitigating sets
     * `mitigated_at`, resolving `resolved_at`, reopening clears `resolved_at` (the CHECKs
     * demand both columns change in the same UPDATE). Adds a `status_change` timeline entry
     * and activity rows. `from` is what the person saw: a concurrent change conflicts.
     */
    async setStatus(actorId: string, input: SetIncidentStatusData): Promise<void> {
      const incident = await current(input.incidentId);
      if (incident.status !== input.from) {
        throw conflict("The incident changed meanwhile; reload and try again");
      }
      if (!canTransition(input.from, input.to)) {
        throw invalid(
          `An incident cannot go from ${INCIDENT_STATUS_LABELS[input.from]} to ${INCIDENT_STATUS_LABELS[input.to]}`,
        );
      }
      const at = input.to === "investigating" ? new Date() : (input.at ?? new Date());
      const times: IncidentTimes = {
        startedAt: incident.started_at,
        mitigatedAt: incident.mitigated_at,
        resolvedAt: incident.resolved_at,
      };
      const next = timesAfterTransition(times, input.to, at);
      const error = timeOrderError(input.to, next);
      if (error) throw invalid(error);
      const result = await withTimeChecks(() =>
        db.execute(sql`
          WITH old AS (
            SELECT id, status, mitigated_at, resolved_at FROM incidents
            WHERE id = ${incident.id}::uuid AND deleted_at IS NULL
              AND status = ${input.from}::incident_status
            FOR UPDATE
          ),
          updated AS (
            -- Only the column the move changes is written; the others stay as locked in
            -- old, so a concurrent time edit is never reverted.
            UPDATE incidents SET status = ${input.to}::incident_status,
              mitigated_at = CASE WHEN ${input.to}::text = 'mitigated'
                THEN ${at.toISOString()}::timestamptz ELSE old.mitigated_at END,
              resolved_at = CASE ${input.to}::text
                WHEN 'resolved' THEN ${at.toISOString()}::timestamptz
                WHEN 'investigating' THEN NULL
                ELSE old.resolved_at END,
              updated_at = now()
            FROM old
            WHERE incidents.id = old.id
            RETURNING incidents.id, incidents.mitigated_at, incidents.resolved_at
          ),
          entry AS (
            INSERT INTO incident_timeline (incident_id, at, author_id, kind, body)
            SELECT id, ${at.toISOString()}::timestamptz, ${actorId}::uuid, 'status_change',
              ${statusChangeBody(input.from, input.to)}
            FROM updated
          ),
          changes AS (
            SELECT f.field, f.from_value, f.to_value
            FROM old, updated u, LATERAL (VALUES
              ('status', old.status::text, ${input.to}::text),
              ('mitigatedAt', ${isoText(sql`old.mitigated_at`)}, ${isoText(sql`u.mitigated_at`)}),
              ('resolvedAt', ${isoText(sql`old.resolved_at`)}, ${isoText(sql`u.resolved_at`)})
            ) AS f(field, from_value, to_value)
            WHERE f.from_value IS DISTINCT FROM f.to_value
          ),
          change_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'incident', u.id, ${actorId}::uuid, 'updated', c.field, c.from_value,
              c.to_value
            FROM updated u, changes c
          )
          SELECT id::text FROM updated
        `),
      );
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        throw conflict("The incident changed meanwhile; reload and try again");
      }
    },

    /** Edit started / mitigated / resolved times (validated in order, for the status). */
    async updateTimes(actorId: string, input: UpdateIncidentTimesData): Promise<void> {
      const incident = await current(input.incidentId);
      const error = timeOrderError(incident.status, input);
      if (error) throw invalid(error);
      const result = await withTimeChecks(() =>
        db.execute(sql`
          WITH old AS (
            SELECT id, started_at, mitigated_at, resolved_at FROM incidents
            WHERE id = ${incident.id}::uuid AND deleted_at IS NULL
              AND status = ${incident.status}::incident_status
            FOR UPDATE
          ),
          updated AS (
            UPDATE incidents SET started_at = ${tsOrNull(input.startedAt)},
              mitigated_at = ${tsOrNull(input.mitigatedAt)},
              resolved_at = ${tsOrNull(input.resolvedAt)}, updated_at = now()
            FROM old
            WHERE incidents.id = old.id
            RETURNING incidents.id
          ),
          changes AS (
            SELECT f.field, f.from_value, f.to_value
            FROM old, LATERAL (VALUES
              ('startedAt', ${isoText(sql`old.started_at`)}, ${iso(input.startedAt)}::text),
              ('mitigatedAt', ${isoText(sql`old.mitigated_at`)}, ${iso(input.mitigatedAt)}::text),
              ('resolvedAt', ${isoText(sql`old.resolved_at`)}, ${iso(input.resolvedAt)}::text)
            ) AS f(field, from_value, to_value)
            WHERE f.from_value IS DISTINCT FROM f.to_value
          ),
          change_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'incident', u.id, ${actorId}::uuid, 'updated', c.field, c.from_value,
              c.to_value
            FROM updated u, changes c
          )
          SELECT id::text FROM updated
        `),
      );
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        throw conflict("The incident changed meanwhile; reload and try again");
      }
    },

    /**
     * Title, severity, commander, summary: only the fields sent change, one activity row
     * each. A new commander gets `incident_commander` (unless they made the change).
     */
    async updateIncident(actorId: string, input: UpdateIncidentData): Promise<void> {
      const [incident] = await Promise.all([
        current(input.incidentId),
        checkUser(input.commanderId),
      ]);
      const setCommander = input.commanderId !== undefined;
      const result = await db.execute(sql`
        WITH old AS (
          SELECT id, number, title, severity, commander_id, summary FROM incidents
          WHERE id = ${incident.id}::uuid AND deleted_at IS NULL
          FOR UPDATE
        ),
        updated AS (
          UPDATE incidents SET
            title = COALESCE(${input.title ?? null}::text, old.title),
            severity = COALESCE(${input.severity ?? null}::incident_severity, old.severity),
            commander_id = CASE WHEN ${setCommander}::boolean
              THEN ${uuidOrNull(input.commanderId)} ELSE old.commander_id END,
            summary = COALESCE(${input.summary ?? null}::text, old.summary),
            updated_at = now()
          FROM old
          WHERE incidents.id = old.id
          RETURNING incidents.id, incidents.number, incidents.title, incidents.severity,
            incidents.commander_id, incidents.summary
        ),
        changes AS (
          SELECT f.field, f.from_value, f.to_value
          FROM old, updated u, LATERAL (VALUES
            ('title', old.title, u.title),
            ('severity', old.severity::text, u.severity::text),
            ('summary', old.summary, u.summary)
          ) AS f(field, from_value, to_value)
          WHERE f.from_value IS DISTINCT FROM f.to_value
        ),
        change_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'incident', u.id, ${actorId}::uuid, 'updated', c.field, c.from_value,
            c.to_value
          FROM updated u, changes c
        ),
        commander_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'incident', u.id, ${actorId}::uuid, 'updated', 'commanderId',
            old.commander_id::text, u.commander_id::text
          FROM old, updated u
          WHERE old.commander_id IS DISTINCT FROM u.commander_id
          RETURNING id, to_value
        ),
        commander_notified AS (
          ${notificationsInsert({
            actorId,
            source: commanderNotification(sql`
              SELECT u.commander_id, u.id AS incident_id, u.number,
                'commander:' || a.id::text AS event_key
              FROM updated u, commander_activity a
              WHERE u.commander_id IS NOT NULL`),
          })}
        )
        SELECT id::text FROM updated
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Incident");
    },

    /**
     * Replace the affected services. A `RunAtomic`: the first statement locks the incident,
     * so the second (a fresh snapshot) sees a concurrent change's rows and logs what it
     * actually replaced.
     */
    async setServices(actorId: string, input: SetIncidentServicesData): Promise<void> {
      const incident = await current(input.incidentId);
      await checkServices(incident.project_id, input.serviceIds);
      const ids = JSON.stringify(input.serviceIds);
      const results = await options.runAtomic([
        sql`SELECT id FROM incidents WHERE id = ${incident.id}::uuid AND deleted_at IS NULL
          FOR UPDATE`,
        sql`
          WITH inc AS (
            SELECT id, project_id FROM incidents
            WHERE id = ${incident.id}::uuid AND deleted_at IS NULL
          ),
          wanted AS (
            SELECT s.id FROM services s, inc
            WHERE s.project_id = inc.project_id AND s.deleted_at IS NULL
              AND s.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))
          ),
          before AS (
            SELECT coalesce(string_agg(service_id::text, ',' ORDER BY service_id), '') AS ids
            FROM incident_services WHERE incident_id IN (SELECT id FROM inc)
          ),
          removed AS (
            DELETE FROM incident_services
            WHERE incident_id IN (SELECT id FROM inc)
              AND service_id NOT IN (SELECT id FROM wanted)
          ),
          added AS (
            INSERT INTO incident_services (incident_id, service_id)
            SELECT inc.id, wanted.id FROM inc, wanted
            ON CONFLICT DO NOTHING
          ),
          after AS (
            SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') AS ids FROM wanted
          ),
          change_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'incident', inc.id, ${actorId}::uuid, 'updated', 'services', b.ids, a.ids
            FROM inc, before b, after a
            WHERE b.ids <> a.ids
          )
          SELECT id::text FROM inc
        `,
      ]);
      if (rowsOf(results.at(-1), z.object({ id: z.string() })).length === 0) {
        throw notFound("Incident");
      }
    },

    /** A note or action at `at` (default now). `status_change` entries are system-made. */
    async addTimelineEntry(actorId: string, input: AddTimelineEntryData): Promise<{ id: string }> {
      const at = input.at ?? new Date();
      checkNotFuture(at);
      const result = await db.execute(sql`
        INSERT INTO incident_timeline (incident_id, at, author_id, kind, body)
        SELECT id, ${at.toISOString()}::timestamptz, ${actorId}::uuid,
          ${input.kind}::incident_timeline_kind, ${input.body}
        FROM incidents WHERE id = ${input.incidentId}::uuid AND deleted_at IS NULL
        RETURNING id::text
      `);
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw notFound("Incident");
      return row;
    },

    /** Edit one of your own notes or actions (text, and the time when sent). */
    async editTimelineEntry(actorId: string, input: EditTimelineEntryData): Promise<void> {
      if (input.at) checkNotFuture(input.at);
      const at = input.at ? input.at.toISOString() : null;
      const result = await db.execute(sql`
        WITH old AS (
          SELECT t.id, t.incident_id, t.body, t.at FROM incident_timeline t
          JOIN incidents i ON i.id = t.incident_id AND i.deleted_at IS NULL
          WHERE t.id = ${input.entryId}::uuid AND t.author_id = ${actorId}::uuid
            AND t.kind <> 'status_change'
          FOR UPDATE OF t
        ),
        updated AS (
          UPDATE incident_timeline SET body = ${input.body},
            at = COALESCE(${at}::timestamptz, old.at)
          FROM old WHERE incident_timeline.id = old.id
          RETURNING incident_timeline.id, incident_timeline.at
        ),
        changes AS (
          SELECT f.field, f.from_value, f.to_value
          FROM old, updated u, LATERAL (VALUES
            ('timeline.body', old.body, ${input.body}::text),
            ('timeline.at', ${isoText(sql`old.at`)}, ${isoText(sql`u.at`)})
          ) AS f(field, from_value, to_value)
          WHERE f.from_value IS DISTINCT FROM f.to_value
        ),
        change_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value, meta)
          SELECT 'incident', old.incident_id, ${actorId}::uuid, 'timeline_edited', c.field,
            c.from_value, c.to_value, jsonb_build_object('entryId', old.id)
          FROM old, changes c
        )
        SELECT id::text FROM updated
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        throw await timelineRefusal(input.entryId);
      }
    },

    /** Delete one of your own notes or actions. */
    async deleteTimelineEntry(actorId: string, entryId: string): Promise<void> {
      const result = await db.execute(sql`
        WITH removed AS (
          DELETE FROM incident_timeline t
          USING incidents i
          WHERE t.id = ${entryId}::uuid AND t.author_id = ${actorId}::uuid
            AND t.kind <> 'status_change' AND i.id = t.incident_id AND i.deleted_at IS NULL
          RETURNING t.id, t.incident_id, t.body
        ),
        delete_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            meta)
          SELECT 'incident', incident_id, ${actorId}::uuid, 'timeline_deleted',
            'timeline.body', body, jsonb_build_object('entryId', id)
          FROM removed
        )
        SELECT id::text FROM removed
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        throw await timelineRefusal(entryId);
      }
    },

    /** INC-2: link an existing issue (by key) as a follow-up (`entity_links` incident → issue). */
    async linkFollowUp(actorId: string, input: LinkFollowUpData): Promise<{ linkId: string }> {
      const [incident, issue] = await Promise.all([
        current(input.incidentId),
        issueByKey(input.issueKey),
      ]);
      const result = await db.execute(sql`
        WITH linked AS (
          INSERT INTO entity_links (from_type, from_id, to_type, to_id, origin, created_by)
          SELECT 'incident', i.id, 'issue', ${issue.id}::uuid, 'manual', ${actorId}::uuid
          FROM incidents i WHERE i.id = ${incident.id}::uuid AND i.deleted_at IS NULL
          ON CONFLICT DO NOTHING
          RETURNING id, from_id, to_id
        ),
        link_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value)
          SELECT 'incident', from_id, ${actorId}::uuid, 'linked', 'followUp', to_id::text
          FROM linked
        )
        SELECT id::text FROM linked
      `);
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw conflict("That issue is already a follow-up");
      return { linkId: row.id };
    },

    async unlinkFollowUp(actorId: string, input: { incidentId: string; linkId: string }) {
      const result = await db.execute(sql`
        WITH removed AS (
          DELETE FROM entity_links
          WHERE id = ${input.linkId}::uuid AND origin = 'manual' AND from_type = 'incident'
            AND from_id = ${input.incidentId}::uuid AND to_type = 'issue'
          RETURNING id, from_id, to_id
        ),
        unlink_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value)
          SELECT 'incident', from_id, ${actorId}::uuid, 'unlinked', 'followUp', to_id::text
          FROM removed
        )
        SELECT id::text FROM removed
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Follow-up");
    },

    /**
     * INC-2 "Create postmortem": a `postmortem` doc from the built-in template, filled from
     * the incident (summary, impact, timeline, follow-ups), under the "Postmortems" page
     * (created when missing), and `incidents.postmortem_doc_id` set, all in one transaction.
     * Idempotent: an incident with a live postmortem returns it (`created: false`). The
     * per-project docs-tree lock comes first, so two clicks (or two incidents) never make
     * two docs or two "Postmortems" pages.
     */
    async createPostmortem(
      actorId: string,
      incidentId: string,
    ): Promise<{ docId: string; created: boolean }> {
      const data = await postmortemData(incidentId);
      if (data.existingDocId) return { docId: data.existingDocId, created: false };
      const { incident } = data;
      const content = buildPostmortem(data.template?.content ?? builtInPostmortem(), {
        incident: {
          key: formatIncidentKey(incident.number),
          title: incident.title,
          severity: incident.severity,
          status: incident.status,
          startedAt: incident.started_at,
          mitigatedAt: incident.mitigated_at,
          resolvedAt: incident.resolved_at,
          summary: incident.summary,
          serviceNames: data.serviceNames,
        },
        timeline: data.timeline,
        followUps: data.followUps,
      });
      const docId = crypto.randomUUID();
      const parentId = crypto.randomUUID();
      const parentPosition = generateKeyBetween(data.lastRootPosition, null);
      const childPosition = generateKeyBetween(data.lastChildPosition, null);
      const title = postmortemTitle(formatIncidentKey(incident.number), incident.title);
      const projectId = incident.project_id;
      const treeLock = sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`hq.docs_tree:${projectId}`}, 0))`;
      const results = await options.runAtomic([
        treeLock,
        sql`
          WITH inc AS (
            SELECT i.id, i.postmortem_doc_id FROM incidents i
            WHERE i.id = ${incident.id}::uuid AND i.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM docs d
                WHERE d.id = i.postmortem_doc_id AND d.deleted_at IS NULL)
          ),
          existing_parent AS (
            SELECT id FROM docs
            WHERE project_id = ${projectId}::uuid AND parent_id IS NULL AND deleted_at IS NULL
              AND title = ${POSTMORTEMS_PARENT_TITLE}
            ORDER BY created_at, id
            LIMIT 1
          ),
          new_parent AS (
            INSERT INTO docs (id, project_id, parent_id, type, title, content, content_text,
              owner_id, updated_by, position)
            SELECT ${parentId}::uuid, ${projectId}::uuid, NULL, 'page',
              ${POSTMORTEMS_PARENT_TITLE}, ${jsonbOrNull(emptyDoc())}, '', ${actorId}::uuid,
              ${actorId}::uuid, ${parentPosition}
            FROM inc
            WHERE NOT EXISTS (SELECT 1 FROM existing_parent)
            RETURNING id, version, title, content
          ),
          parent_version AS (
            INSERT INTO doc_versions (doc_id, version, title, content, author_id)
            SELECT id, version, title, content, ${actorId}::uuid FROM new_parent
          ),
          parent_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
            SELECT 'doc', id, ${actorId}::uuid, 'created', 'page' FROM new_parent
          ),
          parent AS (
            SELECT id FROM existing_parent UNION ALL SELECT id FROM new_parent
          ),
          inserted AS (
            INSERT INTO docs (id, project_id, parent_id, type, title, content, content_text,
              owner_id, updated_by, position, template_id)
            SELECT ${docId}::uuid, ${projectId}::uuid, parent.id, 'postmortem', ${title},
              ${jsonbOrNull(content)}, ${extractPlainText(content)}, ${actorId}::uuid,
              ${actorId}::uuid, ${childPosition}, ${uuidOrNull(data.template?.id)}
            FROM inc, parent
            RETURNING id, version, title, content
          ),
          first_version AS (
            INSERT INTO doc_versions (doc_id, version, title, content, author_id)
            SELECT id, version, title, content, ${actorId}::uuid FROM inserted
          ),
          created_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value, meta)
            SELECT 'doc', id, ${actorId}::uuid, 'created', 'postmortem',
              jsonb_build_object('incidentId', ${incident.id}::text)
            FROM inserted
          ),
          ${mentionSyncCtes({
            // Safe inline: the doc is new, so nobody else can be syncing its links.
            fromType: "doc",
            fromId: docId,
            refs: docRefs(content, data.projectKeys),
            actorId,
            gate: sql`EXISTS (SELECT 1 FROM inserted)`,
          })},
          linked AS (
            UPDATE incidents SET postmortem_doc_id = inserted.id, updated_at = now()
            FROM inserted, inc
            WHERE incidents.id = inc.id
            RETURNING incidents.id, inc.postmortem_doc_id AS old_doc_id, inserted.id AS doc_id
          ),
          link_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'incident', id, ${actorId}::uuid, 'updated', 'postmortemDocId',
              old_doc_id::text, doc_id::text
            FROM linked
          )
          SELECT id::text FROM inserted
        `,
      ]);
      const [row] = rowsOf(results.at(-1), z.object({ id: z.string() }));
      if (row) return { docId: row.id, created: true };
      // Someone else created it while this request waited for the lock: open theirs.
      const again = await postmortemData(incidentId);
      if (again.existingDocId) return { docId: again.existingDocId, created: false };
      throw notFound("Incident");
    },
  };

  /** Why an own-entry edit matched nothing: missing, not yours, or a status change. */
  async function timelineRefusal(entryId: string): Promise<ServiceError> {
    const result = await db.execute(sql`
      SELECT t.kind::text FROM incident_timeline t
      JOIN incidents i ON i.id = t.incident_id AND i.deleted_at IS NULL
      WHERE t.id = ${entryId}::uuid
    `);
    const [row] = rowsOf(result, z.object({ kind: z.enum(INCIDENT_TIMELINE_KINDS) }));
    if (!row) return notFound("Timeline entry");
    if (row.kind === "status_change") return forbidden("Status changes cannot be edited");
    return forbidden("You can only change your own timeline entries");
  }

  /** Everything the postmortem needs, read together (one round trip on Neon). */
  async function postmortemData(incidentId: string) {
    const incidentResult = read(
      db.execute(sql`
        SELECT i.id::text, i.project_id::text, i.number, i.title, i.severity::text,
          i.status::text, i.started_at, i.mitigated_at, i.resolved_at, i.summary,
          d.id::text AS existing_doc_id
        FROM incidents i
        LEFT JOIN docs d ON d.id = i.postmortem_doc_id AND d.deleted_at IS NULL
        WHERE i.id = ${incidentId}::uuid AND i.deleted_at IS NULL
      `),
    );
    const projectOf = sql`(SELECT project_id FROM incidents WHERE id = ${incidentId}::uuid)`;
    const servicesResult = read(
      db.execute(sql`
        SELECT s.name FROM incident_services isv
        JOIN services s ON s.id = isv.service_id AND s.deleted_at IS NULL
        WHERE isv.incident_id = ${incidentId}::uuid
        ORDER BY s.position, s.id
      `),
    );
    const timelineResult = read(
      db.execute(sql`
        SELECT at, kind::text, body FROM incident_timeline
        WHERE incident_id = ${incidentId}::uuid
        ORDER BY at, created_at, id
      `),
    );
    const followUpsResult = read(
      db.execute(sql`
        SELECT i.number, i.title, p.key AS project_key FROM entity_links l
        JOIN issues i ON i.id = l.to_id AND i.deleted_at IS NULL
        JOIN projects p ON p.id = i.project_id
        WHERE l.from_type = 'incident' AND l.from_id = ${incidentId}::uuid
          AND l.to_type = 'issue' AND l.origin = 'manual'
        ORDER BY i.number
      `),
    );
    const templateResult = read(
      db.execute(sql`
        SELECT id::text, content FROM templates
        WHERE kind = 'doc' AND subtype = 'postmortem' AND built_in
        LIMIT 1
      `),
    );
    const positionsResult = read(
      db.execute(sql`
        WITH parent AS (
          SELECT id FROM docs
          WHERE project_id = ${projectOf} AND parent_id IS NULL AND deleted_at IS NULL
            AND title = ${POSTMORTEMS_PARENT_TITLE}
          ORDER BY created_at, id
          LIMIT 1
        )
        SELECT
          (SELECT max(position) FROM docs
            WHERE project_id = ${projectOf} AND parent_id IS NULL AND deleted_at IS NULL)
            AS last_root,
          (SELECT max(d.position) FROM docs d, parent
            WHERE d.parent_id = parent.id AND d.deleted_at IS NULL) AS last_child
      `),
    );
    const keysResult = read(db.select({ key: projects.key }).from(projects));
    const [incidentRows, serviceRows, timelineRows, followUpRows, templateRows, positions, keys] =
      await Promise.all([
        incidentResult,
        servicesResult,
        timelineResult,
        followUpsResult,
        templateResult,
        positionsResult,
        keysResult,
      ]);
    const [incident] = rowsOf(
      incidentRows,
      currentRow.extend({
        title: z.string(),
        severity: z.enum(INCIDENT_SEVERITIES),
        summary: z.string(),
        existing_doc_id: z.string().nullable(),
      }),
    );
    if (!incident) throw notFound("Incident");
    const [template] = rowsOf(templateRows, z.object({ id: z.string(), content: z.unknown() }));
    const [position] = rowsOf(
      positions,
      z.object({ last_root: z.string().nullable(), last_child: z.string().nullable() }),
    );
    return {
      incident,
      existingDocId: incident.existing_doc_id,
      serviceNames: rowsOf(serviceRows, z.object({ name: z.string() })).map((row) => row.name),
      timeline: rowsOf(
        timelineRows,
        z.object({
          at: z.coerce.date(),
          kind: z.enum(INCIDENT_TIMELINE_KINDS),
          body: z.string(),
        }),
      ),
      followUps: rowsOf(
        followUpRows,
        z.object({ number: z.number(), title: z.string(), project_key: z.string() }),
      ).map((row) => ({ key: formatIssueKey(row.project_key, row.number), title: row.title })),
      template: template ? { id: template.id, content: asRichText(template.content) } : null,
      lastRootPosition: position?.last_root ?? null,
      lastChildPosition: position?.last_child ?? null,
      projectKeys: keys.map((row) => row.key),
    };
  }
}

/** The seeded template is the source; this copy is the fallback if it is missing. */
function builtInPostmortem(): RichTextDoc | null {
  return BUILT_IN_DOC_TEMPLATES.find((entry) => entry.subtype === "postmortem")?.content ?? null;
}

function asRichText(value: unknown): RichTextDoc | null {
  const parsed = richTextDocSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type IncidentService = ReturnType<typeof createIncidentService>;
