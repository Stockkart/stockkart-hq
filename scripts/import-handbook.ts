/**
 * `pnpm import:handbook -- --dir <path> [--dry-run] [--project STK]`: imports an
 * engineering-handbook checkout into HQ (IMP-1/2/3). See src/server/import/handbook.ts.
 *
 * Runs locally against DATABASE_URL, read from the environment like `pnpm db:seed`:
 *
 *   DATABASE_URL='postgres://…' pnpm import:handbook -- --dir ../engineering-handbook
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/import-handbook.ts --dir …
 *
 * The imported content goes only into the database; never commit it to this repo (S-7).
 * `--dry-run` prints what would happen and writes nothing (without DATABASE_URL it plans
 * from the files alone, listing everything as "create").
 */
import { stat } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { formatAdrNumber } from "../src/lib/docs/adr";
import { databaseUrlUsesTls } from "../src/server/db/database-url";
import * as schema from "../src/server/db/schema";
import { transactionRunner } from "../src/server/db/types";
import {
  importHandbook,
  type ImportPlan,
  type ImportSummary,
  planHandbookImport,
  readHandbookDir,
} from "../src/server/import/handbook";

interface Args {
  dir: string;
  dryRun: boolean;
  projectKey: string;
}

const USAGE = "usage: pnpm import:handbook -- --dir <handbook dir> [--dry-run] [--project STK]";

function parseArgs(argv: readonly string[]): Args {
  let dir: string | null = null;
  let dryRun = false;
  let projectKey = "STK";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue; // pnpm may pass the separator through
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--dir") dir = argv[++i] ?? null;
    else if (arg === "--project") projectKey = (argv[++i] ?? "").toUpperCase();
    else throw new Error(`unknown argument ${arg}\n${USAGE}`);
  }
  if (!dir) throw new Error(USAGE);
  if (!/^[A-Z]{2,5}$/.test(projectKey)) throw new Error("--project must be a project key");
  return { dir: path.resolve(dir), dryRun, projectKey };
}

function printPlanOnly(plan: ImportPlan) {
  process.stdout.write("dry run without DATABASE_URL: planned from the files only\n");
  for (const doc of plan.docs)
    process.stdout.write(`  would create  ${doc.sourcePath}  ${doc.title}\n`);
  for (const skip of plan.skipped)
    process.stdout.write(`  skip          ${skip.path}  (${skip.reason})\n`);
  for (const warning of plan.warnings) process.stdout.write(`  warning: ${warning}\n`);
}

function printSummary(summary: ImportSummary) {
  const verb = summary.dryRun ? "would " : "";
  for (const result of summary.results) {
    const label = `${verb}${result.action}`.padEnd(16);
    const reason = result.reason ? `  (${result.reason})` : "";
    process.stdout.write(`  ${label}${result.sourcePath}  ${result.title}${reason}\n`);
  }
  for (const skip of summary.skippedFiles) {
    process.stdout.write(`  ${"skip".padEnd(16)}${skip.path}  (${skip.reason})\n`);
  }
  for (const warning of summary.warnings) process.stdout.write(`  warning: ${warning}\n`);
  const { create, update, unchanged, skip } = summary.counts;
  process.stdout.write(
    `${summary.dryRun ? "dry run" : "import"}: ${create} created, ${update} updated, ` +
      `${unchanged} unchanged, ${skip} skipped\n`,
  );
  const numbers = summary.adrNumbers.map(formatAdrNumber).join(", ");
  process.stdout.write(`ADRs: ${numbers || "none"}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!(await stat(args.dir).catch(() => null))?.isDirectory()) {
    throw new Error(`--dir ${args.dir} is not a directory`);
  }
  const plan = planHandbookImport(await readHandbookDir(args.dir));

  const url = process.env.DATABASE_URL;
  if (!url) {
    if (args.dryRun) return printPlanOnly(plan);
    throw new Error("DATABASE_URL is not set (pass it in the environment, never in a file)");
  }
  // Same rule as src/env.ts: encrypted connections only, except to a loopback Postgres.
  if (!databaseUrlUsesTls(url)) throw new Error("DATABASE_URL must set sslmode=require");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool, schema, casing: "snake_case" });
    const summary = await importHandbook(db, plan, {
      projectKey: args.projectKey,
      dryRun: args.dryRun,
      runAtomic: transactionRunner(db),
    });
    // Paths, titles and counts only; never the connection string.
    printSummary(summary);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("import-handbook failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
