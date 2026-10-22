import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { type StatusCategory, type StatusDefaultFor } from "@/lib/issues/constants";
import { BUILT_IN_DIAGRAM_TEMPLATES } from "@/lib/templates/diagram-templates";
import { BUILT_IN_DOC_TEMPLATES } from "@/lib/templates/doc-templates";
import { BUILT_IN_ISSUE_TEMPLATES } from "@/lib/templates/issue-templates";
import { rowsOf } from "@/server/services/sql";

import { components, projects, statuses, templates } from "./schema";
import { type AppDatabase } from "./types";

/**
 * Idempotent bootstrap data: the STK project, its components, the §4.4 workflow and the
 * built-in templates. No user data. Safe to re-run: existing rows are left alone (names,
 * repos and statuses may have been edited in the app), except built-in templates, which are
 * owned by the code and refreshed.
 */

export const SEED_PROJECT = {
  key: "STK",
  name: "Stockkart",
  description: "Stockkart: inventory-api, inventory-platform and the tooling around them.",
} as const;

export const SEED_COMPONENTS: { name: string; githubRepo: string | null }[] = [
  { name: "inventory-api", githubRepo: "Stockkart/inventory-api" },
  { name: "inventory-platform", githubRepo: "Stockkart/inventory-platform" },
  { name: "infra", githubRepo: null },
  { name: "loadtest", githubRepo: null },
  { name: "hq", githubRepo: "Stockkart/stockkart-hq" },
];

/** SPEC §4.4 default statuses, in board order. */
export const DEFAULT_STATUSES: {
  name: string;
  category: StatusCategory;
  isDefaultFor: StatusDefaultFor | null;
}[] = [
  { name: "Triage", category: "todo", isDefaultFor: "bug" },
  { name: "Backlog", category: "todo", isDefaultFor: "other" },
  { name: "Todo", category: "todo", isDefaultFor: null },
  { name: "In Progress", category: "in_progress", isDefaultFor: null },
  { name: "In Review", category: "in_progress", isDefaultFor: null },
  { name: "Done", category: "done", isDefaultFor: null },
  { name: "Won't Do", category: "done", isDefaultFor: null },
];

export interface SeedSummary {
  projectId: string;
  projectCreated: boolean;
  componentsCreated: number;
  statusesCreated: number;
  templatesUpserted: number;
}

/** Creates a project's default workflow, but only when it has no statuses yet. */
export async function seedDefaultStatuses(db: AppDatabase, projectId: string): Promise<number> {
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statuses)
    .where(eq(statuses.projectId, projectId));
  // A project that already has a workflow keeps it (statuses may have been renamed).
  if ((existing?.count ?? 0) > 0) return 0;
  const inserted = await db
    .insert(statuses)
    .values(DEFAULT_STATUSES.map((status, position) => ({ ...status, projectId, position })))
    .onConflictDoNothing()
    .returning({ id: statuses.id });
  return inserted.length;
}

export async function seed(db: AppDatabase): Promise<SeedSummary> {
  const created = await db
    .insert(projects)
    .values(SEED_PROJECT)
    .onConflictDoNothing({ target: projects.key })
    .returning({ id: projects.id });
  const [project] = created.length
    ? created
    : await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.key, SEED_PROJECT.key))
        .limit(1);
  if (!project) throw new Error(`seed: project ${SEED_PROJECT.key} not found after insert`);

  const insertedComponents = await db
    .insert(components)
    .values(SEED_COMPONENTS.map((component) => ({ ...component, projectId: project.id })))
    .onConflictDoNothing({ target: [components.projectId, components.name] })
    .returning({ id: components.id });

  const statusesCreated = await seedDefaultStatuses(db, project.id);

  let templatesUpserted = 0;
  const builtIns = [
    ...BUILT_IN_ISSUE_TEMPLATES.map((template) => ({ kind: "issue" as const, ...template })),
    // DOC-5 / §6.1: upserted on (kind, subtype) like the issue templates.
    ...BUILT_IN_DOC_TEMPLATES.map((template) => ({ kind: "doc" as const, ...template })),
  ];
  for (const template of builtIns) {
    const rows = await db
      .insert(templates)
      .values({ builtIn: true, ...template })
      .onConflictDoUpdate({
        target: [templates.kind, templates.subtype],
        targetWhere: sql`${templates.builtIn}`,
        set: {
          name: template.name,
          description: template.description,
          content: template.content,
          updatedAt: new Date(),
        },
      })
      .returning({ id: templates.id });
    templatesUpserted += rows.length;
  }
  // DGM-3 / §6.3: the content is a scene, not rich text, so these go in as raw jsonb (the
  // Drizzle column is typed for doc/issue templates). Same upsert key as above.
  for (const template of BUILT_IN_DIAGRAM_TEMPLATES) {
    const result = await db.execute(sql`
      INSERT INTO templates (kind, subtype, name, description, content, built_in)
      VALUES ('diagram', ${template.subtype}, ${template.name}, ${template.description},
        ${JSON.stringify(template.content)}::jsonb, TRUE)
      ON CONFLICT (kind, subtype) WHERE built_in DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description,
          content = EXCLUDED.content, updated_at = now()
      RETURNING id::text
    `);
    templatesUpserted += rowsOf(result, z.object({ id: z.string() })).length;
  }

  return {
    projectId: project.id,
    projectCreated: created.length > 0,
    componentsCreated: insertedComponents.length,
    statusesCreated,
    templatesUpserted,
  };
}
