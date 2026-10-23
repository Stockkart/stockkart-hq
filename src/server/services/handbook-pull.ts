import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { GIT_NULL_SHA, HANDBOOK_NOT_CONFIGURED_MESSAGE } from "@/lib/handbook/constants";
import { isImportableHandbookFile, parsePulledFile } from "@/lib/handbook/parse-file";
import { type importHandbookFileInput, type pullApplyInput } from "@/lib/handbook/schemas";
import { shortSha } from "@/lib/handbook/sync-state";
import { type CheckOutcome, type PullPreview, type PullState } from "@/lib/handbook/views";
import { extractPlainText } from "@/lib/rich-text";
import { lineDiff } from "@/lib/text/line-diff";
import { docs, projects } from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";
import { gitBlobSha } from "@/server/handbook/git-blob";
import {
  type HandbookGithub,
  HandbookGithubError,
  HandbookNotConfigured,
} from "@/server/handbook/github-app";
import { DECISIONS_DIR, HANDBOOK_ROOT, planHandbookImport } from "@/server/import/handbook";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { type HandbookDocRow, loadHandbookDocs, markdownOf, pathOf } from "./handbook-docs";
import {
  docRefs,
  jsonbOrNull,
  mentionSyncCtes,
  mentionSyncStatement,
  rowsOf,
  uuidOrNull,
} from "./sql";

export type PullApplyData = z.output<typeof pullApplyInput>;
export type ImportFileData = z.output<typeof importHandbookFileInput>;

/** "Check handbook now": once a minute per project, across every server instance. */
export const CHECK_INTERVAL_SECONDS = 60;
export const CHECK_RATE_LIMITED_MESSAGE =
  "The handbook was checked less than a minute ago; try again shortly";

export interface HandbookPullDeps {
  runAtomic: RunAtomic;
  read?: Read;
  github: HandbookGithub;
}

/**
 * Repo → HQ (DOC-14). Every GitHub call here runs from a server action the person started
 * (never during a page render, never inside the webhook).
 *
 *   preview   reads the file on the default branch, diffs HQ's export (old) against it (new)
 *             and classifies: in sync | repo ahead (HQ unchanged since the last sync: a
 *             clean pull) | both changed (conflict: take the handbook's, or keep HQ's and
 *             publish with overwrite) | HQ ahead (nothing to pull) | removed. It records the
 *             blob it saw (and the baseline when the contents already match).
 *   apply     re-reads the file; applies only if it is still the blob the diff showed AND
 *             the doc is still at the version it was made from (optimistic lock, §7.4):
 *             version + 1, a snapshot of the HQ copy it replaces and of the new one, an
 *             activity row "pulled from handbook (sha abc1234)", the sync columns.
 *   check     lists the default branch's tree (one call) and records every mapped doc's
 *             blob, baselining docs whose export already matches; returns unmapped files.
 *   import    creates a doc from an unmapped file with the importer's conversion.
 */
export function createHandbookPullService(db: AppDatabase, deps: HandbookPullDeps) {
  const read = deps.read ?? directRead;
  const github = deps.github;

  function requireConfigured() {
    if (!github.configured()) throw invalid(HANDBOOK_NOT_CONFIGURED_MESSAGE);
  }

  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HandbookNotConfigured) throw invalid(HANDBOOK_NOT_CONFIGURED_MESSAGE);
      if (error instanceof HandbookGithubError) {
        throw invalid(`GitHub request failed (${error.code}); try again later`);
      }
      throw error;
    }
  }

  async function loadOne(docId: string): Promise<HandbookDocRow> {
    const [row] = await loadHandbookDocs(db, read, { docIds: [docId] });
    if (!row) throw notFound("Doc");
    return row;
  }

  async function remoteFile(path: string) {
    return guarded(async () => {
      const main = await github.getDefaultBranch();
      return github.getFile(path, main.sha);
    });
  }

  /** Records the blob seen (or its absence); baselines the sync when HQ already matches. */
  async function recordRemote(row: HandbookDocRow, remoteSha: string, matches: boolean) {
    await db.execute(sql`
      UPDATE docs SET handbook_remote_sha = ${remoteSha}, handbook_remote_seen_at = now(),
        handbook_blob_sha = CASE WHEN ${matches}::boolean THEN ${remoteSha} ELSE handbook_blob_sha END,
        handbook_synced_version = CASE WHEN ${matches}::boolean THEN version
          ELSE handbook_synced_version END,
        handbook_synced_at = CASE WHEN ${matches}::boolean THEN now() ELSE handbook_synced_at END
      WHERE id = ${row.id}::uuid AND deleted_at IS NULL
        AND (NOT ${matches}::boolean OR version = ${row.version}::int)
    `);
  }

  function classify(row: HandbookDocRow, localSha: string, remoteSha: string): PullState {
    if (localSha === remoteSha) return "in_sync";
    const synced = row.handbookBlobSha !== null && row.handbookSyncedVersion !== null;
    if (synced && remoteSha === row.handbookBlobSha) return "hq_ahead";
    const hqUnchanged = synced ? row.version === row.handbookSyncedVersion : !row.editedInHq;
    return hqUnchanged ? "repo_ahead" : "both_changed";
  }

  /** The rate limit as a reservation (like AUTH-8's): count + insert in one locked step. */
  async function reserveCheck(projectId: string): Promise<boolean> {
    const key = `handbook_check:${projectId}`;
    const [, reserved] = await deps.runAtomic([
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hq.handbook_check:${projectId}`}, 0))`,
      // `success = true`: these rows never count as failed sign-ins (AUTH-8 counts
      // `NOT success` rows of `email:` / `ip:` keys only).
      sql`
        WITH pruned AS (
          DELETE FROM login_attempts
          WHERE key = ${key} AND attempted_at < now() - interval '1 day'
        )
        INSERT INTO login_attempts (key, success)
        SELECT ${key}, true
        WHERE NOT EXISTS (
          SELECT 1 FROM login_attempts WHERE key = ${key}
            AND attempted_at > now() - make_interval(secs => ${CHECK_INTERVAL_SECONDS}::int)
        )
        RETURNING id
      `,
    ]);
    return rowsOf(reserved, z.object({ id: z.string() })).length > 0;
  }

  return {
    async preview(_actorId: string, docId: string): Promise<PullPreview> {
      requireConfigured();
      const row = await loadOne(docId);
      const path = pathOf(row);
      const hqMarkdown = markdownOf(row, path);
      const file = await remoteFile(path);
      if (!file) {
        await recordRemote(row, GIT_NULL_SHA, false);
        return {
          docId: row.id,
          path,
          state: "removed",
          baseVersion: row.version,
          remoteSha: null,
          diff: [],
        };
      }
      const localSha = gitBlobSha(hqMarkdown);
      await recordRemote(row, file.sha, localSha === file.sha);
      return {
        docId: row.id,
        path,
        state: classify(row, localSha, file.sha),
        baseVersion: row.version,
        remoteSha: file.sha,
        diff: lineDiff(hqMarkdown, file.content),
      };
    },

    /** "Take handbook version" (also the clean pull of a repo-ahead doc). */
    async apply(actorId: string, input: PullApplyData): Promise<{ version: number }> {
      requireConfigured();
      const row = await loadOne(input.docId);
      if (row.version !== input.baseVersion) {
        throw conflict("The doc changed in HQ since the review; review again");
      }
      const path = pathOf(row);
      const file = await remoteFile(path);
      if (!file) throw conflict("The file is no longer in the handbook");
      if (file.sha !== input.remoteSha) {
        throw conflict("The handbook changed again; review the new diff");
      }
      if (gitBlobSha(markdownOf(row, path)) === file.sha) {
        // Same content: only the sync columns change, no new version.
        await recordRemote(row, file.sha, true);
        return { version: row.version };
      }
      const pulled = parsePulledFile(row, file.content);
      if (!pulled) throw invalid("The handbook file is too large or too deeply nested to pull");
      const projectKeys = (await read(db.select({ key: projects.key }).from(projects))).map(
        (project) => project.key,
      );
      const adr = pulled.adr;
      const status = adr?.status ?? null;
      const meta = JSON.stringify({ sha: file.sha, path });
      const [result] = await deps.runAtomic([
        sql`
          WITH previous AS (
            -- Keep the HQ copy being replaced in the history (saves snapshot only every
            -- 10 minutes, so the current version may not have one yet).
            INSERT INTO doc_versions (doc_id, version, title, content, author_id)
            SELECT id, version, title, content, updated_by FROM docs
            WHERE id = ${row.id}::uuid AND version = ${input.baseVersion}::int
              AND deleted_at IS NULL
            ON CONFLICT (doc_id, version) DO NOTHING
          ),
          updated AS (
            UPDATE docs SET title = ${pulled.title}, content = ${jsonbOrNull(pulled.content)},
              content_text = ${extractPlainText(pulled.content)},
              adr_status = CASE WHEN type = 'adr' AND ${status}::adr_status IS NOT NULL
                THEN ${status}::adr_status ELSE adr_status END,
              adr_superseded_by = CASE
                WHEN type <> 'adr' OR ${status}::adr_status IS NULL THEN adr_superseded_by
                WHEN ${status}::adr_status = 'superseded' THEN (
                  SELECT t.id FROM docs t
                  WHERE t.project_id = docs.project_id AND t.type = 'adr'
                    AND t.adr_number = ${adr?.supersededByNumber ?? null}::int
                    AND t.deleted_at IS NULL AND t.id <> docs.id)
                ELSE NULL END,
              version = version + 1, updated_by = ${actorId}::uuid, updated_at = now(),
              handbook_blob_sha = ${file.sha}, handbook_synced_version = version + 1,
              handbook_synced_at = now(), handbook_remote_sha = ${file.sha},
              handbook_remote_seen_at = now()
            WHERE id = ${row.id}::uuid AND version = ${input.baseVersion}::int
              AND deleted_at IS NULL
            RETURNING id, version, title, content
          ),
          snapshot AS (
            INSERT INTO doc_versions (doc_id, version, title, content, author_id)
            SELECT id, version, title, content, ${actorId}::uuid FROM updated
          ),
          logged AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value, meta)
            SELECT 'doc', id, ${actorId}::uuid, 'handbook_pulled', 'handbook',
              ${String(input.baseVersion)}, ${shortSha(file.sha)}, ${meta}::jsonb
            FROM updated
          )
          SELECT version FROM updated
        `,
        mentionSyncStatement({
          fromType: "doc",
          fromId: row.id,
          refs: docRefs(pulled.content, projectKeys),
          actorId,
          // As saveDoc: only if this transaction wrote the doc.
          gate: sql`EXISTS (SELECT 1 FROM docs WHERE id = ${row.id}::uuid
            AND xmin = pg_current_xact_id()::xid)`,
        }),
      ]);
      const [written] = rowsOf(result, z.object({ version: z.number() }));
      if (!written) throw conflict("The doc changed in HQ since the review; review again");
      return { version: written.version };
    },

    /** "Check handbook now" (Settings → Handbook). */
    async check(_actorId: string, projectKey: string): Promise<CheckOutcome> {
      requireConfigured();
      const [project] = await read(
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.key, projectKey), isNull(projects.archivedAt)))
          .limit(1),
      );
      if (!project) throw notFound(`Project ${projectKey}`);
      if (!(await reserveCheck(project.id))) throw conflict(CHECK_RATE_LIMITED_MESSAGE);

      const tree = await guarded(async () => {
        const main = await github.getDefaultBranch();
        return github.listTree(main.sha);
      });
      const remote = new Map(tree.map((entry) => [entry.path.toLowerCase(), entry]));
      const rows = await loadHandbookDocs(db, read, { projectKey });
      // Every live doc's path (stored or default), so "New in handbook" never offers a file
      // a doc would publish to.
      const claimed = new Set(rows.map((row) => pathOf(row).toLowerCase()));
      const mapped = rows.filter(
        (row) =>
          (row.handbookPath ?? row.sourcePath) !== null || remote.has(pathOf(row).toLowerCase()),
      );
      const updates = mapped.map((row) => {
        const path = pathOf(row);
        const entry = remote.get(path.toLowerCase());
        const sha = entry?.sha ?? GIT_NULL_SHA;
        return {
          id: row.id,
          version: row.version,
          sha,
          baseline: entry !== undefined && gitBlobSha(markdownOf(row, path)) === entry.sha,
        };
      });
      if (updates.length > 0) {
        await db.execute(sql`
          UPDATE docs SET handbook_remote_sha = r.sha, handbook_remote_seen_at = now(),
            handbook_blob_sha = CASE WHEN r.baseline THEN r.sha ELSE docs.handbook_blob_sha END,
            handbook_synced_version = CASE WHEN r.baseline THEN docs.version
              ELSE docs.handbook_synced_version END,
            handbook_synced_at = CASE WHEN r.baseline THEN now() ELSE docs.handbook_synced_at END
          FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
            AS r(id uuid, version int, sha text, baseline boolean)
          WHERE docs.id = r.id AND docs.deleted_at IS NULL
            AND (NOT r.baseline OR docs.version = r.version)
        `);
      }
      const drifted = updates.filter((update) => {
        const row = mapped.find((candidate) => candidate.id === update.id);
        return !update.baseline && row !== undefined && update.sha !== row.handbookBlobSha;
      }).length;
      const newFiles = tree
        .filter((entry) => isImportableHandbookFile(entry.path))
        .filter((entry) => !claimed.has(entry.path.toLowerCase()))
        .map((entry) => ({ path: entry.path, sha: entry.sha }));
      return { checked: updates.length, drifted, newFiles };
    },

    /** "Import" of a "New in handbook" file, with the importer's conversion (IMP-1/2). */
    async importFile(actorId: string, input: ImportFileData): Promise<{ id: string }> {
      requireConfigured();
      if (!isImportableHandbookFile(input.path)) {
        throw invalid("Only top-level files and decisions/NNNN-*.md ADRs can be imported");
      }
      const [project] = await read(
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.key, input.projectKey), isNull(projects.archivedAt)))
          .limit(1),
      );
      if (!project) throw notFound(`Project ${input.projectKey}`);
      const file = await remoteFile(input.path);
      if (!file) throw notFound("Handbook file");
      const plan = planHandbookImport([{ path: input.path, markdown: file.content }]);
      const planned = plan.docs.find((doc) => doc.kind !== "group");
      if (!planned) {
        throw invalid(plan.skipped[0]?.reason ?? "This file cannot be imported");
      }
      const parentPath = planned.kind === "adr" ? DECISIONS_DIR : HANDBOOK_ROOT;
      const [parent] = await db
        .select({ id: docs.id })
        .from(docs)
        .where(
          and(
            eq(docs.projectId, project.id),
            eq(docs.sourcePath, parentPath),
            isNull(docs.deletedAt),
          ),
        )
        .limit(1);
      const parentId = parent?.id ?? null;
      const [last] = await db
        .select({ position: docs.position })
        .from(docs)
        .where(
          and(
            eq(docs.projectId, project.id),
            parentId ? eq(docs.parentId, parentId) : isNull(docs.parentId),
            isNull(docs.deletedAt),
          ),
        )
        .orderBy(desc(docs.position), desc(docs.id))
        .limit(1);
      const position = generateKeyBetween(last?.position ?? null, null);
      const projectKeys = (await db.select({ key: projects.key }).from(projects)).map(
        (item) => item.key,
      );
      const id = crypto.randomUUID();
      const isAdr = planned.kind === "adr";
      const type = isAdr ? "adr" : planned.type;
      try {
        const result = await db.execute(sql`
          WITH inserted AS (
            INSERT INTO docs (id, project_id, parent_id, type, title, content, content_text,
              position, adr_number, adr_status, adr_superseded_by, source_path, updated_by,
              handbook_blob_sha, handbook_synced_version, handbook_synced_at,
              handbook_remote_sha, handbook_remote_seen_at)
            VALUES (${id}::uuid, ${project.id}::uuid, ${uuidOrNull(parentId)},
              ${type}::doc_type, ${planned.title}, ${jsonbOrNull(planned.content)},
              ${extractPlainText(planned.content)}, ${position},
              ${isAdr ? planned.number : null}::int,
              ${isAdr ? planned.status : null}::adr_status,
              (SELECT t.id FROM docs t WHERE t.project_id = ${project.id}::uuid
                AND t.type = 'adr' AND t.deleted_at IS NULL
                AND t.adr_number = ${isAdr ? planned.supersededByNumber : null}::int),
              ${input.path}, ${actorId}::uuid, ${file.sha}, 1, now(), ${file.sha}, now())
            RETURNING id, version, title, content
          ),
          first_version AS (
            INSERT INTO doc_versions (doc_id, version, title, content, author_id)
            SELECT id, version, title, content, ${actorId}::uuid FROM inserted
          ),
          created_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value, meta)
            SELECT 'doc', id, ${actorId}::uuid, 'created', ${type},
              ${JSON.stringify({ source: "handbook", path: input.path, sha: file.sha })}::jsonb
            FROM inserted
          ),
          ${mentionSyncCtes({
            // Safe inline: the doc is new.
            fromType: "doc",
            fromId: id,
            refs: docRefs(planned.content, projectKeys),
            actorId,
            gate: sql`EXISTS (SELECT 1 FROM inserted)`,
          })}
          SELECT id::text FROM inserted
        `);
        const [row] = rowsOf(result, z.object({ id: z.string() }));
        if (!row) throw conflict("The doc was not created; try again");
        return row;
      } catch (error) {
        const info = pgErrorInfo(error);
        if (
          info?.code === UNIQUE_VIOLATION &&
          info.constraint === "docs_project_adr_number_unique"
        ) {
          throw conflict(`An ADR with that number already exists in HQ`);
        }
        if (info?.code === UNIQUE_VIOLATION) throw conflict(`A doc already maps to ${input.path}`);
        throw error;
      }
    },
  };
}

export type HandbookPullService = ReturnType<typeof createHandbookPullService>;
