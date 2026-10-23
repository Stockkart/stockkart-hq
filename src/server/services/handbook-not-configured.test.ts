import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { HANDBOOK_NOT_CONFIGURED_MESSAGE } from "@/lib/handbook/constants";
import * as schema from "@/server/db/schema";
import { transactionRunner } from "@/server/db/types";
import { fakeHandbookRepo } from "@/test/handbook-fakes";

import { createHandbookPublishService, isSpecialHandbookPath } from "./handbook-publish";
import { createHandbookPullService } from "./handbook-pull";

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const SHA = "a".repeat(40);

/**
 * DOC-14 fail closed: without the GitHub App every write (and every GitHub read) refuses
 * with "Handbook sync isn't set up" BEFORE touching the database or GitHub. The pool points
 * at a closed loopback port and must never be used.
 */
describe("handbook sync without the GitHub App", () => {
  const pool = new Pool({ connectionString: "postgres://none:none@127.0.0.1:1/none" });
  const connect = vi.spyOn(pool, "connect");
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  const repo = fakeHandbookRepo({ configured: false });
  const deps = { runAtomic: transactionRunner(db), github: repo.github };
  const publish = createHandbookPublishService(db, deps);
  const pull = createHandbookPullService(db, deps);

  it.each([
    [
      "publish",
      () =>
        publish.publish(ID, {
          projectKey: "STK",
          docIds: [ID],
          overwrite: [],
          acknowledgedPublic: true,
          confirmSpecialPath: false,
        }),
    ],
    ["publish preview", () => publish.preview(ID, { docId: ID })],
    ["pull preview", () => pull.preview(ID, ID)],
    ["pull apply", () => pull.apply(ID, { docId: ID, baseVersion: 1, remoteSha: SHA })],
    ["check now", () => pull.check(ID, "STK")],
    ["import file", () => pull.importFile(ID, { projectKey: "STK", path: "NEW.md" })],
  ])("%s fails closed", async (_name, run) => {
    await expect(run()).rejects.toThrow(HANDBOOK_NOT_CONFIGURED_MESSAGE);
    expect(connect).not.toHaveBeenCalled();
    expect(repo.calls).toEqual([]);
  });

  it("asks before writing paths GitHub gives a meaning to", () => {
    expect(isSpecialHandbookPath("README.md")).toBe(true);
    expect(isSpecialHandbookPath("security.md")).toBe(true);
    expect(isSpecialHandbookPath("decisions/0000-template.md")).toBe(true);
    expect(isSpecialHandbookPath("RUNBOOK.md")).toBe(false);
    expect(isSpecialHandbookPath("docs/README.md")).toBe(false);
  });
});
