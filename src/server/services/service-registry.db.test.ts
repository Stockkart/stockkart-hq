import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createServiceInput, updateServiceInput } from "@/lib/service-registry/schemas";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createIssueService } from "./issues";
import { createServiceRegistry, createServiceRegistryQueries } from "./service-registry";
import { projectIdByKey, rowsOf } from "./sql";

/** SVC-1 against Postgres: slugs, "No secrets", defaults, activity, order and links. */
describeDb("service registry (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let registry: ReturnType<typeof createServiceRegistry>;
  let queries: ReturnType<typeof createServiceRegistryQueries>;

  const create = (fields: Record<string, unknown>) =>
    registry.createService(ada, createServiceInput.parse({ projectKey: "STK", ...fields }));

  async function activityOf(serviceId: string) {
    const result = await db.execute(sql`
      SELECT action, field, from_value, to_value FROM activity
      WHERE entity_type = 'service' AND entity_id = ${serviceId}::uuid ORDER BY created_at, id
    `);
    return rowsOf(
      result,
      z.object({
        action: z.string(),
        field: z.string().nullable(),
        from_value: z.string().nullable(),
        to_value: z.string().nullable(),
      }),
    );
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    ada = await createTestUser(db, "Ada Admin");
    registry = createServiceRegistry(db, { runAtomic: transactionRunner(db) });
    queries = createServiceRegistryQueries(db);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("slugs", () => {
    it("derives the slug from the name and numbers duplicates", async () => {
      const first = await create({ name: "Billing API" });
      const second = await create({ name: "Billing  api" });
      const third = await create({ name: "billing-API!" });
      expect([first.slug, second.slug, third.slug]).toEqual([
        "billing-api",
        "billing-api-2",
        "billing-api-3",
      ]);
    });

    it("auto slugs do not collide under concurrent creates", async () => {
      const created = await Promise.all(Array.from({ length: 5 }, () => create({ name: "Racer" })));
      expect(new Set(created.map((service) => service.slug)).size).toBe(5);
    });

    it("refuses an explicit slug that is taken, even by a deleted service", async () => {
      await create({ name: "Queue", slug: "queue" });
      await expect(create({ name: "Other", slug: "queue" })).rejects.toThrow(/already taken/);
      const doomed = await create({ name: "Doomed", slug: "doomed" });
      await registry.deleteService(ada, doomed.id);
      await expect(create({ name: "Doomed again", slug: "doomed" })).rejects.toThrow(
        /already taken/,
      );
      // An auto slug skips it.
      expect((await create({ name: "Doomed" })).slug).toBe("doomed-2");
    });

    it("refuses renaming the slug onto another service's", async () => {
      const a = await create({ name: "Slug A" });
      await create({ name: "Slug B" });
      await expect(
        registry.updateService(
          ada,
          updateServiceInput.parse({ serviceId: a.id, name: "Slug A", slug: "slug-b" }),
        ),
      ).rejects.toThrow(/already taken/);
    });
  });

  describe("no secrets (SVC-1)", () => {
    it("the service refuses unsafe URLs even when the schema was skipped", async () => {
      const base = createServiceInput.parse({ projectKey: "STK", name: "Unsafe" });
      for (const url of [
        "javascript:alert(1)",
        "https://user:pass@db.example.com",
        "ftp://files.example.com",
      ]) {
        await expect(
          registry.createService(ada, { ...base, links: [{ label: "x", kind: "app", url }] }),
        ).rejects.toThrow(/URL/);
      }
    });

    it("the service refuses secret-looking text anywhere in the form", async () => {
      const base = createServiceInput.parse({ projectKey: "STK", name: "Leaky" });
      const cases = [
        { ...base, notes: ["mongodb+srv://app", ":pw1234@cluster0.example.net"].join("") },
        { ...base, description: ["key AKIA", "ABCDEFGHIJKLMNOP"].join("") },
        { ...base, environments: [{ name: "prod", notes: "password: hunter2hunter2" }] },
        {
          ...base,
          links: [{ label: "Logs", kind: "logs" as const, url: "https://l.example/?token=x" }],
        },
      ];
      for (const input of cases) {
        await expect(registry.createService(ada, input)).rejects.toThrow(
          /Don't store passwords, tokens or connection strings here/,
        );
      }
      const result = await db.execute(sql`SELECT count(*)::int AS n FROM services
        WHERE name IN ('Leaky', 'Unsafe')`);
      expect(rowsOf(result, z.object({ n: z.number() }))[0]?.n).toBe(0);
    });

    it("stores safe URLs normalised", async () => {
      const saved = await create({
        name: "Safe",
        environments: [{ name: "production", url: "https://APP.example.com", notes: "" }],
        links: [{ label: "Dashboard", kind: "dashboard", url: "http://localhost:3000/d" }],
      });
      const detail = await queries.getService(projectIdByKey("STK"), saved.slug);
      expect(detail?.environments).toEqual([
        { name: "production", url: "https://app.example.com/" },
      ]);
      expect(detail?.links).toEqual([
        { label: "Dashboard", kind: "dashboard", url: "http://localhost:3000/d" },
      ]);
    });
  });

  it("logs one activity row per changed field", async () => {
    const saved = await create({ name: "Audited", runtime: "Vercel" });
    await registry.updateService(
      ada,
      updateServiceInput.parse({
        serviceId: saved.id,
        name: "Audited",
        runtime: "DigitalOcean App Platform",
        repo: "Stockkart/audited",
        ownerId: ada,
        links: [{ label: "App", kind: "app", url: "https://audited.example.com" }],
      }),
    );
    const rows = await activityOf(saved.id);
    expect(rows[0]).toMatchObject({ action: "created", field: null });
    // One statement: same created_at, so compare the set of fields.
    expect(
      rows
        .slice(1)
        .map((row) => `${row.action}:${row.field}`)
        .sort(),
    ).toEqual(["updated:links", "updated:ownerId", "updated:repo", "updated:runtime"]);
    expect(rows.find((row) => row.field === "runtime")).toMatchObject({
      from_value: "Vercel",
      to_value: "DigitalOcean App Platform",
    });
  });

  it("adds the Stockkart defaults once, without URLs", async () => {
    const first = await registry.addDefaults(ada, "STK");
    expect(first.created).toEqual([
      "inventory-api",
      "inventory-platform",
      "stockkart-hq",
      "mongodb-atlas",
      "neon-postgres",
    ]);
    expect((await registry.addDefaults(ada, "STK")).created).toEqual([]);
    const list = await queries.listServices(projectIdByKey("STK"));
    const defaults = list.filter((card) => first.created.includes(card.slug));
    expect(defaults).toHaveLength(5);
    expect(
      defaults.every((card) => card.links.length === 0 && card.environments.length === 0),
    ).toBe(true);
    expect(defaults.find((card) => card.slug === "inventory-api")).toMatchObject({
      runtime: "DigitalOcean App Platform",
      repo: "Stockkart/inventory-api",
    });
  });

  it("reorders with fractional keys and soft-deletes", async () => {
    const projectId = projectIdByKey("STK");
    const before = await queries.listServices(projectId);
    const last = before.at(-1);
    if (!last) throw new Error("no services");
    await registry.moveService(ada, { serviceId: last.id, index: 0 });
    const after = await queries.listServices(projectId);
    expect(after[0]?.id).toBe(last.id);
    await registry.deleteService(ada, last.id);
    expect((await queries.listServices(projectId)).map((card) => card.id)).not.toContain(last.id);
    await expect(registry.deleteService(ada, last.id)).rejects.toThrow(/not found/);
  });

  it("links issues by key and docs, and lists them", async () => {
    const saved = await create({ name: "Linked" });
    const issue = await createIssueService(db, { runAtomic: transactionRunner(db) }).createIssue(
      ada,
      { projectKey: "STK", type: "task", title: "Rotate keys", priority: 2 },
    );
    await registry.link(ada, { serviceId: saved.id, target: "issue", issueKey: issue.key });
    await expect(
      registry.link(ada, { serviceId: saved.id, target: "issue", issueKey: issue.key }),
    ).rejects.toThrow(/already linked/);
    const links = await queries.serviceLinks(saved.id);
    expect(links).toEqual([
      expect.objectContaining({ kind: "issue", label: `${issue.key} Rotate keys` }),
    ]);
    const [link] = links;
    if (!link) throw new Error("no link");
    await registry.unlink(ada, { serviceId: saved.id, linkId: link.linkId });
    expect(await queries.serviceLinks(saved.id)).toEqual([]);
  });
});
