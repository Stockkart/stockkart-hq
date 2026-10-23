import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type IncidentSeverity } from "@/lib/incidents/constants";
import { type AppDatabase } from "@/server/db/types";

import { notFound } from "./errors";
import { rowsOf, uuidOrNull } from "./sql";

export interface NewIncident {
  /** Pre-generated so related rows (services, timeline) can reference it in the same call. */
  id?: string;
  projectId: string;
  title: string;
  severity: IncidentSeverity;
  /** Defaults to now. */
  startedAt?: Date;
  commanderId?: string | null;
  summary?: string;
}

export interface AllocatedIncident {
  id: string;
  number: number;
}

const allocatedRow = z.object({ id: z.string(), number: z.coerce.number().int().positive() });

/**
 * INC-1. Allocates `INC-<n>` and inserts the incident in ONE statement, exactly like issue
 * numbers (`createIssue`):
 *
 *   UPDATE projects SET incident_counter = incident_counter + 1 … RETURNING incident_counter
 *   → INSERT INTO incidents (number = that value) → INSERT INTO activity ('created')
 *
 * The UPDATE row-locks the project, so concurrent creators queue on it and each re-reads the
 * committed counter: numbers are unique and gapless per project (the unique
 * (project_id, number) index backs that up), and a failed insert rolls the counter back.
 * Only live (unarchived) projects get incidents. Throws `notFound` otherwise.
 *
 * The incidents slice adds affected services, the first timeline note and the commander's
 * notification through `extraCtes` (same statement, so all or nothing); this helper stays
 * the one place that numbers incidents.
 */
export async function allocateIncidentNumber(
  db: AppDatabase,
  actorId: string,
  input: NewIncident,
  /**
   * More data-modifying CTEs for the SAME statement (they may read the `inserted` CTE:
   * `id, number, severity`), so related rows commit atomically with the incident. The
   * incidents slice adds the affected services, the first timeline entry and the
   * commander's notification this way (INC-1).
   */
  extraCtes?: SQL,
): Promise<AllocatedIncident> {
  const id = input.id ?? crypto.randomUUID();
  const startedAt = input.startedAt ?? new Date();
  const result = await db.execute(sql`
    WITH counter AS (
      UPDATE projects SET incident_counter = incident_counter + 1, updated_at = now()
      WHERE id = ${input.projectId}::uuid AND archived_at IS NULL
      RETURNING incident_counter
    ),
    inserted AS (
      INSERT INTO incidents (id, project_id, number, title, severity, started_at,
        commander_id, summary)
      SELECT ${id}::uuid, ${input.projectId}::uuid, counter.incident_counter, ${input.title},
        ${input.severity}::incident_severity, ${startedAt.toISOString()}::timestamptz,
        ${uuidOrNull(input.commanderId)}, ${input.summary ?? ""}
      FROM counter
      RETURNING id, number, severity
    ),
    created_activity AS (
      INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
      SELECT 'incident', inserted.id, ${actorId}::uuid, 'created', inserted.severity::text
      FROM inserted
    )${extraCtes ? sql`, ${extraCtes}` : sql``}
    SELECT id, number FROM inserted
  `);
  const [row] = rowsOf(result, allocatedRow);
  if (!row) throw notFound("Project");
  return row;
}
