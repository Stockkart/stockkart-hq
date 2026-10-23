import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import { docPath } from "@/lib/docs/views";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@/lib/incidents/constants";
import { formatIssueKey, issuePath, parseIssueKey } from "@/lib/issues/keys";
import { parseSafeUrl } from "@/lib/links/safe-url";
import {
  RECENT_INCIDENT_DAYS,
  SERVICE_LINK_KINDS,
  type ServiceEnvironment,
  type ServiceLink,
} from "@/lib/service-registry/constants";
import { STOCKKART_DEFAULT_SERVICES } from "@/lib/service-registry/defaults";
import {
  type createServiceInput,
  type linkServiceInput,
  type moveServiceInput,
  type ServiceFields,
  type updateServiceInput,
} from "@/lib/service-registry/schemas";
import {
  findSecretInText,
  findSecretInUrl,
  secretErrorMessage,
} from "@/lib/service-registry/secrets";
import { serviceSlug, slugCandidate } from "@/lib/service-registry/slug";
import {
  type ServiceCard,
  type ServiceDetail,
  type ServiceIncidentRow,
  type ServiceLinkView,
  type UserOption,
} from "@/lib/service-registry/views";
import { directRead, type Read } from "@/server/db/read-batch";
import { docs, issues, projects, users } from "@/server/db/schema";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { type IdRef, jsonbOrNull, rowsOf, uuidOrNull } from "./sql";

export type CreateServiceData = z.output<typeof createServiceInput>;
export type UpdateServiceData = z.output<typeof updateServiceInput>;
export type MoveServiceData = z.output<typeof moveServiceInput>;
export type LinkServiceData = z.output<typeof linkServiceInput>;

export interface SavedService {
  id: string;
  slug: string;
}

export interface ServiceRegistryOptions {
  runAtomic: RunAtomic;
  read?: Read;
}

const SLUG_CONSTRAINT = "services_project_slug_unique";
/** Auto slugs tried before giving up (`api`, `api-2` … when several share a name). */
const SLUG_ATTEMPTS = 20;
const PICKER_LIMIT = 20;

/** `%`, `_` and `\` are literal in a title search. */
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The id of the live service with this slug in that project; NULL when there is none. */
export const serviceIdBySlug = (projectId: IdRef, slug: string): SQL =>
  sql`(SELECT id FROM services WHERE project_id = ${projectId}::uuid AND slug = ${slug}
    AND deleted_at IS NULL)`;

// Stored JSON is read leniently: a malformed element is dropped, never shown raw.
const storedEnvironment = z.object({
  name: z.string(),
  url: z.string().optional(),
  notes: z.string().optional(),
});
const storedLink = z.object({
  kind: z.enum(SERVICE_LINK_KINDS),
  label: z.string(),
  url: z.string(),
});

function parseEnvironments(value: unknown): ServiceEnvironment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = storedEnvironment.safeParse(item);
    if (!parsed.success) return [];
    // Only links that pass the safe-URL check ever reach an href.
    const url = parsed.data.url ? parseSafeUrl(parsed.data.url) : null;
    return [{ name: parsed.data.name, ...(url ? { url } : {}), notes: parsed.data.notes }];
  });
}

function parseLinks(value: unknown): ServiceLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = storedLink.safeParse(item);
    const url = parsed.success ? parseSafeUrl(parsed.data.url) : null;
    return parsed.success && url ? [{ ...parsed.data, url }] : [];
  });
}

const cardRow = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  runtime: z.string().nullable(),
  repo: z.string().nullable(),
  owner_id: z.string().nullable(),
  owner_name: z.string().nullable(),
  environments: z.unknown(),
  links: z.unknown(),
  position: z.string(),
  recent_incidents: z.coerce.number(),
});

function toCard(row: z.infer<typeof cardRow>): ServiceCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    runtime: row.runtime,
    repo: row.repo,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    environments: parseEnvironments(row.environments),
    links: parseLinks(row.links),
    position: row.position,
    recentIncidents: row.recent_incidents,
  };
}

const cardColumns = sql`s.id::text, s.slug, s.name, s.description, s.runtime, s.repo,
  s.owner_id::text, u.name AS owner_name, s.environments, s.links, s.position,
  (SELECT count(*)::int FROM incident_services isv
    JOIN incidents i ON i.id = isv.incident_id AND i.deleted_at IS NULL
    WHERE isv.service_id = s.id
      AND i.started_at > now() - make_interval(days => ${RECENT_INCIDENT_DAYS}::int)
  ) AS recent_incidents`;

/**
 * Server-side "No secrets" check of already-parsed fields (SVC-1): the action's Zod schema
 * runs the same heuristic, this repeats it where the write happens, so no caller can skip
 * it. Every URL must also pass `parseSafeUrl`.
 */
export function assertNoSecrets(fields: ServiceFields): void {
  const texts: [string, string | null | undefined][] = [
    ["Name", fields.name],
    ["Slug", fields.slug],
    ["Description", fields.description],
    ["Repo", fields.repo],
    ["Runtime", fields.runtime],
    ["Notes", fields.notes],
    ...fields.environments.flatMap((env): [string, string | undefined][] => [
      ["Environment name", env.name],
      ["Environment notes", env.notes],
    ]),
    ...fields.links.map((link): [string, string] => ["Link label", link.label]),
  ];
  for (const [label, value] of texts) {
    const found = value ? findSecretInText(value) : null;
    if (found) throw invalid(secretErrorMessage(label, found));
  }
  const urls: [string, string | undefined][] = [
    ...fields.environments.map((env): [string, string | undefined] => ["Environment URL", env.url]),
    ...fields.links.map((link): [string, string] => ["Link URL", link.url]),
  ];
  for (const [label, url] of urls) {
    if (url === undefined) continue;
    const found = findSecretInUrl(url);
    if (found) throw invalid(secretErrorMessage(label, found));
    if (parseSafeUrl(url) === null) {
      throw invalid(`${label}: enter a full http(s) URL without a username or password`);
    }
  }
}

/** The stored JSON arrays (only the keys we define, URLs normalised). */
function environmentsJson(fields: ServiceFields): ServiceEnvironment[] {
  return fields.environments.map((env) => ({
    name: env.name,
    ...(env.url ? { url: env.url } : {}),
    ...(env.notes ? { notes: env.notes } : {}),
  }));
}

function linksJson(fields: ServiceFields): ServiceLink[] {
  return fields.links.map((link) => ({ kind: link.kind, label: link.label, url: link.url }));
}

const isSlugTaken = (error: unknown) => {
  const info = pgErrorInfo(error);
  return info?.code === UNIQUE_VIOLATION && info.constraint === SLUG_CONSTRAINT;
};

/**
 * SVC-1 service registry: writes (create, edit, reorder, soft delete, "Add Stockkart
 * defaults", links) and the reads of its pages. Every field change logs an `activity` row
 * (entity_type `service`) in the statement of the change.
 */
export function createServiceRegistry(db: AppDatabase, options: ServiceRegistryOptions) {
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

  async function checkUser(userId: string | null) {
    if (!userId) return;
    const [row] = await read(
      db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1),
    );
    if (!row) throw notFound("Owner");
  }

  async function liveService(serviceId: string) {
    const result = await read(
      db.execute(sql`
        SELECT id::text, project_id::text, slug, position FROM services
        WHERE id = ${serviceId}::uuid AND deleted_at IS NULL
      `),
    );
    const [row] = rowsOf(
      result,
      z.object({ id: z.string(), project_id: z.string(), slug: z.string(), position: z.string() }),
    );
    if (!row) throw notFound("Service");
    return row;
  }

  /** Live services in list order (for a key between neighbours). */
  async function listOrder(projectId: string) {
    const result = await db.execute(sql`
      SELECT id::text, position FROM services
      WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
      ORDER BY position, id
    `);
    return rowsOf(result, z.object({ id: z.string(), position: z.string() }));
  }

  /** Every slug of the project starting with `base` (soft-deleted ones keep theirs). */
  async function slugsLike(projectId: string, base: string): Promise<Set<string>> {
    const result = await db.execute(sql`
      SELECT slug FROM services
      WHERE project_id = ${projectId}::uuid AND (slug = ${base} OR slug LIKE ${`${base}-%`})
    `);
    return new Set(rowsOf(result, z.object({ slug: z.string() })).map((row) => row.slug));
  }

  async function insertService(
    actorId: string,
    projectId: string,
    slug: string,
    fields: ServiceFields,
    position: string,
  ): Promise<SavedService> {
    const result = await db.execute(sql`
      WITH inserted AS (
        INSERT INTO services (project_id, name, slug, description, repo, runtime, owner_id,
          environments, links, notes, position)
        VALUES (${projectId}::uuid, ${fields.name}, ${slug}, ${fields.description},
          ${fields.repo}, ${fields.runtime}, ${uuidOrNull(fields.ownerId)},
          ${jsonbOrNull(environmentsJson(fields))}, ${jsonbOrNull(linksJson(fields))},
          ${fields.notes}, ${position})
        RETURNING id, slug
      ),
      created_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
        SELECT 'service', id, ${actorId}::uuid, 'created', slug FROM inserted
      )
      SELECT id::text, slug FROM inserted
    `);
    const [row] = rowsOf(result, z.object({ id: z.string(), slug: z.string() }));
    if (!row) throw notFound("Service");
    return row;
  }

  function keyAt(others: { position: string }[], index: number): string | null {
    const before = others[index - 1]?.position ?? null;
    const after = others[index]?.position ?? null;
    if (before !== null && after !== null && before >= after) return null;
    return generateKeyBetween(before, after);
  }

  async function issueByKey(issueKey: string) {
    const ref = parseIssueKey(issueKey);
    if (!ref) throw invalid("Enter an issue key such as STK-12");
    const [issue] = await read(
      db
        .select({ id: issues.id, projectId: issues.projectId })
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

  async function liveDoc(docId: string) {
    const [doc] = await read(
      db
        .select({ id: docs.id, projectId: docs.projectId })
        .from(docs)
        .where(and(eq(docs.id, docId), isNull(docs.deletedAt)))
        .limit(1),
    );
    if (!doc) throw notFound("Doc");
    return doc;
  }

  return {
    /**
     * New service at the end of the list. Without a slug one is derived from the name
     * (`api`, then `api-2` … if taken); an explicit slug that is taken is a conflict.
     */
    async createService(actorId: string, input: CreateServiceData): Promise<SavedService> {
      assertNoSecrets(input);
      const [project] = await Promise.all([
        projectByKey(input.projectKey),
        checkUser(input.ownerId),
      ]);
      const order = await listOrder(project.id);
      const position = generateKeyBetween(order.at(-1)?.position ?? null, null);
      if (input.slug) {
        try {
          return await insertService(actorId, project.id, input.slug, input, position);
        } catch (error) {
          if (isSlugTaken(error)) throw conflict(`The slug “${input.slug}” is already taken`);
          throw error;
        }
      }
      const base = serviceSlug(input.name);
      for (let attempt = 1; attempt <= SLUG_ATTEMPTS;) {
        const taken = await slugsLike(project.id, base);
        while (attempt <= SLUG_ATTEMPTS && taken.has(slugCandidate(base, attempt))) attempt += 1;
        if (attempt > SLUG_ATTEMPTS) break;
        try {
          return await insertService(
            actorId,
            project.id,
            slugCandidate(base, attempt),
            input,
            position,
          );
        } catch (error) {
          // Someone took it between the read and the insert: try the next one.
          if (!isSlugTaken(error)) throw error;
          attempt += 1;
        }
      }
      throw conflict("Too many services with that name; enter a slug");
    },

    /** Edit every form field; one `activity` row per changed field, same statement. */
    async updateService(actorId: string, input: UpdateServiceData): Promise<SavedService> {
      assertNoSecrets(input);
      const [service] = await Promise.all([liveService(input.serviceId), checkUser(input.ownerId)]);
      const slug = input.slug ?? service.slug;
      const environments = JSON.stringify(environmentsJson(input));
      const links = JSON.stringify(linksJson(input));
      let result: unknown;
      try {
        // `old` locks the row, so after a concurrent edit it sees that edit's values and
        // the activity rows record what was actually replaced.
        result = await db.execute(sql`
          WITH old AS (
            SELECT id, name, slug, description, repo, runtime, owner_id, environments, links,
              notes
            FROM services
            WHERE id = ${service.id}::uuid AND deleted_at IS NULL
            FOR UPDATE
          ),
          updated AS (
            UPDATE services SET name = ${input.name}, slug = ${slug},
              description = ${input.description}, repo = ${input.repo},
              runtime = ${input.runtime}, owner_id = ${uuidOrNull(input.ownerId)},
              environments = ${environments}::jsonb, links = ${links}::jsonb,
              notes = ${input.notes}, updated_at = now()
            FROM old
            WHERE services.id = old.id
            RETURNING services.id, services.slug
          ),
          changes AS (
            SELECT f.field, f.from_value, f.to_value
            FROM old, LATERAL (VALUES
              ('name', old.name, ${input.name}::text),
              ('slug', old.slug, ${slug}::text),
              ('description', old.description, ${input.description}::text),
              ('repo', old.repo, ${input.repo}::text),
              ('runtime', old.runtime, ${input.runtime}::text),
              ('ownerId', old.owner_id::text, ${input.ownerId}::text),
              ('environments', old.environments::text, ${environments}::jsonb::text),
              ('links', old.links::text, ${links}::jsonb::text),
              ('notes', old.notes, ${input.notes}::text)
            ) AS f(field, from_value, to_value)
            WHERE f.from_value IS DISTINCT FROM f.to_value
          ),
          change_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'service', u.id, ${actorId}::uuid, 'updated', c.field, c.from_value,
              c.to_value
            FROM updated u, changes c
          )
          SELECT id::text, slug FROM updated
        `);
      } catch (error) {
        if (isSlugTaken(error)) throw conflict(`The slug “${slug}” is already taken`);
        throw error;
      }
      const [row] = rowsOf(result, z.object({ id: z.string(), slug: z.string() }));
      if (!row) throw notFound("Service");
      return row;
    },

    /** Soft delete (§9.3). The slug stays taken, so a restore never conflicts. */
    async deleteService(actorId: string, serviceId: string): Promise<void> {
      const result = await db.execute(sql`
        WITH deleted AS (
          UPDATE services SET deleted_at = now(), updated_at = now()
          WHERE id = ${serviceId}::uuid AND deleted_at IS NULL
          RETURNING id
        ),
        delete_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action)
          SELECT 'service', id, ${actorId}::uuid, 'deleted' FROM deleted
        )
        SELECT id::text FROM deleted
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Service");
    },

    /** List order: a fractional key between the new neighbours (respaced on a tie). */
    async moveService(_actorId: string, input: MoveServiceData): Promise<void> {
      const service = await liveService(input.serviceId);
      const others = (await listOrder(service.project_id)).filter((row) => row.id !== service.id);
      const index = Math.min(input.index, others.length);
      let position = keyAt(others, index);
      let respace: SQL | null = null;
      if (position === null) {
        const keys = generateNKeysBetween(null, null, others.length);
        const respaced = others.map((row, i) => ({ id: row.id, position: keys[i] ?? "" }));
        respace = sql`
          UPDATE services SET position = r.position
          FROM jsonb_to_recordset(${JSON.stringify(respaced)}::jsonb) AS r(id uuid, position text)
          WHERE services.id = r.id
        `;
        position = keyAt(respaced, index) ?? generateKeyBetween(null, null);
      }
      // Ordering is not a field change: no activity row (like docs and diagrams).
      const move = sql`
        UPDATE services SET position = ${position}
        WHERE id = ${service.id}::uuid AND deleted_at IS NULL
        RETURNING id::text
      `;
      const results = await options.runAtomic(respace ? [respace, move] : [move]);
      if (rowsOf(results.at(-1), z.object({ id: z.string() })).length === 0) {
        throw notFound("Service");
      }
    },

    /**
     * "Add Stockkart defaults": the five known services, without URLs. Idempotent by slug
     * (`ON CONFLICT DO NOTHING`, soft-deleted ones included), so it adds only what is
     * missing. Returns the slugs it created.
     */
    async addDefaults(actorId: string, projectKey: string): Promise<{ created: string[] }> {
      const project = await projectByKey(projectKey);
      const order = await listOrder(project.id);
      const keys = generateNKeysBetween(
        order.at(-1)?.position ?? null,
        null,
        STOCKKART_DEFAULT_SERVICES.length,
      );
      const rows = STOCKKART_DEFAULT_SERVICES.map((service, i) => ({
        ...service,
        position: keys[i] ?? "",
      }));
      const result = await db.execute(sql`
        WITH input AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS r(slug text, name text, runtime text, repo text, description text,
              position text)
        ),
        inserted AS (
          INSERT INTO services (project_id, slug, name, runtime, repo, description, position)
          SELECT ${project.id}::uuid, slug, name, runtime, repo, description, position
          FROM input
          ON CONFLICT (project_id, slug) DO NOTHING
          RETURNING id, slug
        ),
        created_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value, meta)
          SELECT 'service', id, ${actorId}::uuid, 'created', slug,
            '{"source":"defaults"}'::jsonb
          FROM inserted
        )
        SELECT slug FROM inserted
      `);
      return { created: rowsOf(result, z.object({ slug: z.string() })).map((row) => row.slug) };
    },

    /** "Linked": a manual link service → issue (by key) or → doc. */
    async link(actorId: string, input: LinkServiceData): Promise<{ linkId: string }> {
      const [service, target] = await Promise.all([
        liveService(input.serviceId),
        input.target === "issue" ? issueByKey(input.issueKey) : liveDoc(input.docId),
      ]);
      // Docs only from the service's own project (the picker offers no others).
      if (input.target === "doc" && target.projectId !== service.project_id) {
        throw notFound("Doc");
      }
      const result = await db.execute(sql`
        WITH linked AS (
          INSERT INTO entity_links (from_type, from_id, to_type, to_id, origin, created_by)
          VALUES ('service', ${service.id}::uuid, ${input.target}::entity_type,
            ${target.id}::uuid, 'manual', ${actorId}::uuid)
          ON CONFLICT DO NOTHING
          RETURNING id, to_type, to_id
        ),
        link_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value)
          SELECT 'service', ${service.id}::uuid, ${actorId}::uuid, 'linked', to_type::text,
            to_id::text
          FROM linked
        )
        SELECT id::text FROM linked
      `);
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw conflict(`That ${input.target} is already linked`);
      return { linkId: row.id };
    },

    async unlink(actorId: string, input: { serviceId: string; linkId: string }): Promise<void> {
      const result = await db.execute(sql`
        WITH removed AS (
          DELETE FROM entity_links
          WHERE id = ${input.linkId}::uuid AND origin = 'manual' AND from_type = 'service'
            AND from_id = ${input.serviceId}::uuid
          RETURNING id, to_type, to_id
        ),
        unlink_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value)
          SELECT 'service', ${input.serviceId}::uuid, ${actorId}::uuid, 'unlinked',
            to_type::text, to_id::text
          FROM removed
        )
        SELECT id::text FROM removed
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Link");
    },
  };
}

export type ServiceRegistry = ReturnType<typeof createServiceRegistry>;

/**
 * Reads of the service pages (SVC-1). Every query takes ids or `IdRef` subqueries, so a
 * page starts them all together: ONE round trip on Neon (README "Performance").
 */
export function createServiceRegistryQueries(
  db: AppDatabase,
  { read = directRead }: { read?: Read } = {},
) {
  return {
    /** The list, in list order, with each service's recent incident count. */
    async listServices(projectId: IdRef): Promise<ServiceCard[]> {
      const result = await read(
        db.execute(sql`
          SELECT ${cardColumns}
          FROM services s LEFT JOIN users u ON u.id = s.owner_id
          WHERE s.project_id = ${projectId}::uuid AND s.deleted_at IS NULL
          ORDER BY s.position, s.id
        `),
      );
      return rowsOf(result, cardRow).map(toCard);
    },

    async getService(projectId: IdRef, slug: string): Promise<ServiceDetail | null> {
      const result = await read(
        db.execute(sql`
          SELECT ${cardColumns}, s.notes, s.created_at, s.updated_at
          FROM services s LEFT JOIN users u ON u.id = s.owner_id
          WHERE s.project_id = ${projectId}::uuid AND s.slug = ${slug} AND s.deleted_at IS NULL
        `),
      );
      const [row] = rowsOf(
        result,
        cardRow.extend({
          notes: z.string().nullable(),
          created_at: z.coerce.date(),
          updated_at: z.coerce.date(),
        }),
      );
      if (!row) return null;
      return {
        ...toCard(row),
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    /** Incidents that affect the service, newest first. */
    async serviceIncidents(serviceId: IdRef): Promise<ServiceIncidentRow[]> {
      const result = await read(
        db.execute(sql`
          SELECT i.id::text, i.number, i.title, i.severity::text, i.status::text, i.started_at
          FROM incident_services isv
          JOIN incidents i ON i.id = isv.incident_id AND i.deleted_at IS NULL
          WHERE isv.service_id = ${serviceId}::uuid
          ORDER BY i.started_at DESC, i.number DESC
          LIMIT 100
        `),
      );
      return rowsOf(
        result,
        z.object({
          id: z.string(),
          number: z.number(),
          title: z.string(),
          severity: z.enum(INCIDENT_SEVERITIES),
          status: z.enum(INCIDENT_STATUSES),
          started_at: z.coerce.date(),
        }),
      ).map((row) => ({
        id: row.id,
        number: row.number,
        title: row.title,
        severity: row.severity,
        status: row.status,
        startedAt: row.started_at,
      }));
    },

    /** Docs and issues linked from the service (live ones only). */
    async serviceLinks(serviceId: IdRef): Promise<ServiceLinkView[]> {
      const result = await read(
        db.execute(sql`
          SELECT l.id::text AS link_id, l.to_type::text AS kind, l.to_id::text AS target_id,
            i.number AS issue_number, i.title AS issue_title, ip.key AS issue_project_key,
            d.title AS doc_title, dp.key AS doc_project_key
          FROM entity_links l
          LEFT JOIN issues i ON l.to_type = 'issue' AND i.id = l.to_id AND i.deleted_at IS NULL
          LEFT JOIN projects ip ON ip.id = i.project_id
          LEFT JOIN docs d ON l.to_type = 'doc' AND d.id = l.to_id AND d.deleted_at IS NULL
          LEFT JOIN projects dp ON dp.id = d.project_id
          WHERE l.from_type = 'service' AND l.from_id = ${serviceId}::uuid
            AND l.to_type IN ('issue', 'doc')
          ORDER BY l.to_type, coalesce(d.title, i.title)
        `),
      );
      const rows = rowsOf(
        result,
        z.object({
          link_id: z.string(),
          kind: z.enum(["issue", "doc"]),
          target_id: z.string(),
          issue_number: z.number().nullable(),
          issue_title: z.string().nullable(),
          issue_project_key: z.string().nullable(),
          doc_title: z.string().nullable(),
          doc_project_key: z.string().nullable(),
        }),
      );
      return rows.flatMap((row): ServiceLinkView[] => {
        if (row.kind === "issue" && row.issue_number !== null && row.issue_project_key) {
          const key = formatIssueKey(row.issue_project_key, row.issue_number);
          return [
            {
              linkId: row.link_id,
              kind: "issue",
              label: `${key} ${row.issue_title ?? ""}`.trim(),
              href: issuePath(row.issue_project_key, row.issue_number),
            },
          ];
        }
        if (row.kind === "doc" && row.doc_project_key && row.doc_title !== null) {
          return [
            {
              linkId: row.link_id,
              kind: "doc",
              label: row.doc_title,
              href: docPath(row.doc_project_key, row.target_id),
            },
          ];
        }
        return []; // the other side was deleted
      });
    },

    /** Owner picker: every HQ user. */
    async userOptions(): Promise<UserOption[]> {
      return read(
        db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .orderBy(users.name),
      );
    },

    /** "Linked" → doc picker: live docs of the project by title. */
    async docOptions(projectKey: string, query: string): Promise<{ id: string; title: string }[]> {
      const q = query.trim();
      const result = await read(
        db.execute(sql`
          SELECT d.id::text, d.title FROM docs d JOIN projects p ON p.id = d.project_id
          WHERE p.key = ${projectKey} AND d.deleted_at IS NULL
            AND (${q} = '' OR d.title ILIKE ${likePattern(q)})
          ORDER BY d.updated_at DESC
          LIMIT ${PICKER_LIMIT}
        `),
      );
      return rowsOf(result, z.object({ id: z.string(), title: z.string() }));
    },
  };
}

export type ServiceRegistryQueries = ReturnType<typeof createServiceRegistryQueries>;
