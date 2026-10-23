import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { HANDBOOK_DECISIONS_DIR } from "@/lib/docs/handbook-path";
import {
  GIT_NULL_SHA,
  GIT_SHA_PATTERN,
  HANDBOOK_NOT_CONFIGURED_MESSAGE,
} from "@/lib/handbook/constants";
import { type publishInput, type publishPreviewInput } from "@/lib/handbook/schemas";
import { type PublishOutcome, type PublishPreview } from "@/lib/handbook/views";
import { findSecretInText } from "@/lib/service-registry/secrets";
import { lineDiff } from "@/lib/text/line-diff";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";
import { gitBlobSha } from "@/server/handbook/git-blob";
import {
  type HandbookGithub,
  HandbookGithubError,
  HandbookNotConfigured,
} from "@/server/handbook/github-app";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { type HandbookDocRow, loadHandbookDocs, markdownOf, pathOf } from "./handbook-docs";
import { rowsOf } from "./sql";

export type PublishData = z.output<typeof publishInput>;
export type PublishPreviewData = z.output<typeof publishPreviewInput>;

/** An open publication that never got its PR (the request died mid-way) frees its docs after this. */
export const ABANDONED_CLAIM_MINUTES = 15;
/** GitHub calls at a time while reading the repo's current files. */
const READ_CONCURRENCY = 5;

export const DRIFT_MESSAGE = "Changed in the handbook since your last sync: pull first";
export const REMOVED_MESSAGE =
  "Removed from the handbook since your last sync: confirm in the publish dialog to add it back";

/** Paths GitHub gives a meaning to, or the ADR template: the dialog asks before writing them. */
export function isSpecialHandbookPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower === `${HANDBOOK_DECISIONS_DIR}/0000-template.md`) return true;
  if (lower.includes("/")) return false;
  return /^(readme|license|licence|copying|security|contributing|code_of_conduct|support|governance|funding|citation|codeowners)\.md$/.test(
    lower,
  );
}

export interface HandbookPublishDeps {
  runAtomic: RunAtomic;
  read?: Read;
  github: HandbookGithub;
  /** Test hooks. */
  now?: () => Date;
  newId?: () => string;
}

/** Runs `fn` over `items`, `limit` at a time, keeping the order of the results. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) out[index] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The secret heuristic (SVC-1) over a whole file: a finding blocks the publish, no override. */
function secretMessage(row: HandbookDocRow, markdown: string): string | null {
  const found = findSecretInText(markdown);
  return found
    ? `“${row.title}” ${found.message}. Remove it before publishing: the handbook repo is public.`
    : null;
}

const yyyymmdd = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "");

/**
 * HQ → repo (DOC-14). Publishing opens ONE pull request with every chosen doc in ONE commit
 * on a fresh `hq/publish-<yyyymmdd>-<id>` branch; it never pushes to the default branch.
 *
 * Order (so nothing is half-recorded and two publishes of a doc cannot both open PRs):
 *   1. read the docs, export them, block on a secret-looking value, check paths
 *   2. read the repo's current blobs; skip files that already match (recorded as in sync),
 *      refuse files changed in the handbook since the last sync (unless the person reviewed
 *      that exact blob and chose "Keep HQ version")
 *   3. CLAIM: one statement inserts the publication (`open`, no PR yet) and its docs, and
 *      persists each doc's path. The one-open-publication-per-doc index refuses a doc that
 *      is already being published ("Already in an open PR: …")
 *   4. GitHub: branch → one commit (Git Data API) → PR
 *   5. one statement records the PR and an activity row per doc; on any failure the
 *      publication becomes `failed` with a short `error_code` (its docs are freed by the FK
 *      cascade). A claim whose request died before 5 is failed after 15 minutes.
 */
export function createHandbookPublishService(db: AppDatabase, deps: HandbookPublishDeps) {
  const read = deps.read ?? directRead;
  const github = deps.github;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;

  function requireConfigured() {
    // Fail closed before any read: without the App nothing is published.
    if (!github.configured()) throw invalid(HANDBOOK_NOT_CONFIGURED_MESSAGE);
  }

  /** GitHub client errors as the person sees them (never a body or a token). */
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

  /** Paths another live doc of the project already owns (case-insensitive). */
  async function takenPaths(projectId: string, files: { docId: string; path: string }[]) {
    const result = await db.execute(sql`
      SELECT f.path FROM jsonb_to_recordset(${JSON.stringify(
        files.map((file) => ({ doc_id: file.docId, path: file.path })),
      )}::jsonb) AS f(doc_id uuid, path text)
      JOIN docs d ON d.project_id = ${projectId}::uuid AND d.deleted_at IS NULL
        AND d.id <> f.doc_id AND lower(coalesce(d.handbook_path, d.source_path)) = lower(f.path)
    `);
    return rowsOf(result, z.object({ path: z.string() })).map((row) => row.path);
  }

  /** Records docs whose export equals the repo file as in sync (no PR needed). */
  async function recordInSync(rows: { row: HandbookDocRow; sha: string }[]) {
    if (rows.length === 0) return;
    const values = JSON.stringify(
      rows.map(({ row, sha }) => ({ id: row.id, version: row.version, sha })),
    );
    await db.execute(sql`
      UPDATE docs SET handbook_blob_sha = r.sha, handbook_synced_version = r.version,
        handbook_synced_at = now(), handbook_remote_sha = r.sha, handbook_remote_seen_at = now()
      FROM jsonb_to_recordset(${values}::jsonb) AS r(id uuid, version int, sha text)
      WHERE docs.id = r.id AND docs.version = r.version AND docs.deleted_at IS NULL
    `);
  }

  async function openPrFor(docIds: readonly string[]): Promise<string | null> {
    const result = await db.execute(sql`
      SELECT p.pr_url FROM handbook_publication_docs pd
      JOIN handbook_publications p ON p.id = pd.publication_id
      WHERE pd.open AND pd.doc_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(docIds)}::jsonb)::uuid)
      ORDER BY p.pr_url NULLS LAST LIMIT 1
    `);
    return rowsOf(result, z.object({ pr_url: z.string().nullable() }))[0]?.pr_url ?? null;
  }

  return {
    /** The single-doc dialog: markdown, path checks, diff against the repo (asks GitHub). */
    async preview(_actorId: string, input: PublishPreviewData): Promise<PublishPreview> {
      requireConfigured();
      const row = await loadOne(input.docId);
      const path = pathOf(row, input.path);
      const markdown = markdownOf(row, path);
      const [taken] = await takenPaths(row.projectId, [{ docId: row.id, path }]);
      if (taken) throw conflict(`Another doc already uses ${taken}`);
      const remote = await guarded(async () => {
        const main = await github.getDefaultBranch();
        return github.getFile(path, main.sha);
      });
      const localSha = gitBlobSha(markdown);
      return {
        docId: row.id,
        path,
        markdown,
        remote: remote ? { sha: remote.sha, diff: lineDiff(remote.content, markdown) } : null,
        unchanged: remote?.sha === localSha,
        needsOverwrite:
          remote !== null
            ? remote.sha !== localSha && remote.sha !== row.handbookBlobSha
            : row.handbookBlobSha !== null,
        secret: secretMessage(row, markdown),
        specialPath: isSpecialHandbookPath(path),
      };
    },

    async publish(actorId: string, input: PublishData): Promise<PublishOutcome> {
      requireConfigured();
      // Free docs held by claims whose request died before getting a PR (otherwise they
      // would show "Already being published" forever).
      await db.execute(sql`
        UPDATE handbook_publications SET state = 'failed', error_code = 'abandoned',
          updated_at = now()
        WHERE state = 'open' AND pr_number IS NULL
          AND created_at < now() - make_interval(mins => ${ABANDONED_CLAIM_MINUTES}::int)
          AND id IN (SELECT publication_id FROM handbook_publication_docs
            WHERE open AND doc_id IN (
              SELECT jsonb_array_elements_text(${JSON.stringify(input.docIds)}::jsonb)::uuid))
      `);
      const rows = await loadHandbookDocs(db, read, { docIds: input.docIds });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered = input.docIds.map((id) => byId.get(id));
      if (ordered.some((row) => row === undefined)) throw notFound("Doc");
      const docsInOrder = ordered.filter((row): row is HandbookDocRow => row !== undefined);
      const projectId = docsInOrder[0]?.projectId;
      const projectKey = docsInOrder[0]?.projectKey;
      if (!projectId || !projectKey || projectKey !== input.projectKey) throw notFound("Doc");
      if (docsInOrder.some((row) => row.projectId !== projectId)) {
        throw invalid("Publish docs of one project at a time");
      }

      const outcome: PublishOutcome = { pr: null, published: [], unchanged: [], refused: [] };
      const candidates: { row: HandbookDocRow; path: string; markdown: string }[] = [];
      for (const row of docsInOrder) {
        if (row.openPublicationId) {
          outcome.refused.push({
            docId: row.id,
            title: row.title,
            reason: row.openPrUrl
              ? `Already in an open PR: ${row.openPrUrl}`
              : "Already being published",
          });
          continue;
        }
        const path = pathOf(row, input.path);
        // Paths GitHub gives a meaning to need the single-doc dialog's explicit confirmation.
        if (isSpecialHandbookPath(path) && !input.confirmSpecialPath) {
          outcome.refused.push({
            docId: row.id,
            title: row.title,
            reason: `${path} has a special meaning on GitHub: publish it on its own and confirm`,
          });
          continue;
        }
        const markdown = markdownOf(row, path);
        // Blocking, with no override: the repo is public (S-7, DOC-14).
        const secret = secretMessage(row, markdown);
        if (secret) throw invalid(secret);
        candidates.push({ row, path, markdown });
      }
      const lowerPaths = candidates.map((item) => item.path.toLowerCase());
      if (new Set(lowerPaths).size !== lowerPaths.length) {
        throw invalid("Two of the chosen docs publish to the same path");
      }
      const [taken] = await takenPaths(
        projectId,
        candidates.map((item) => ({ docId: item.row.id, path: item.path })),
      );
      if (taken) throw conflict(`Another doc already uses ${taken}`);

      const overwrite = new Map(input.overwrite.map((item) => [item.docId, item.remoteSha]));
      const main = await guarded(() => github.getDefaultBranch());
      const remotes = await guarded(() =>
        mapLimited(candidates, READ_CONCURRENCY, (item) => github.getFile(item.path, main.sha)),
      );
      const toPublish: ((typeof candidates)[number] & { sha: string })[] = [];
      const same: { row: HandbookDocRow; sha: string }[] = [];
      candidates.forEach((item, index) => {
        const remote = remotes[index] ?? null;
        const sha = gitBlobSha(item.markdown);
        if (remote?.sha === sha) {
          same.push({ row: item.row, sha });
          outcome.unchanged.push({ docId: item.row.id, title: item.row.title });
          return;
        }
        const drifted = remote !== null && remote.sha !== item.row.handbookBlobSha;
        // Removed in the handbook since the last sync: adding it back is a decision too.
        const removed = remote === null && item.row.handbookBlobSha !== null;
        // "Keep HQ version" counts only for the blob (or the absence) the person reviewed.
        const reviewed = overwrite.get(item.row.id);
        if (drifted && remote && reviewed !== remote.sha) {
          outcome.refused.push({
            docId: item.row.id,
            title: item.row.title,
            reason: DRIFT_MESSAGE,
          });
          return;
        }
        if (removed && reviewed !== GIT_NULL_SHA) {
          outcome.refused.push({
            docId: item.row.id,
            title: item.row.title,
            reason: REMOVED_MESSAGE,
          });
          return;
        }
        toPublish.push({ ...item, sha });
      });
      await recordInSync(same);

      if (toPublish.length === 0) {
        const [only] = outcome.refused;
        if (input.docIds.length === 1 && only) throw conflict(only.reason);
        return outcome;
      }

      // 3. Claim, in one statement (the abandoned claims were failed above).
      const publicationId = newId();
      const branch = `hq/publish-${yyyymmdd(now())}-${publicationId.replace(/-/g, "").slice(0, 8)}`;
      const files = JSON.stringify(
        toPublish.map((item) => ({
          doc_id: item.row.id,
          path: item.path,
          doc_version: item.row.version,
          blob_sha: item.sha,
        })),
      );
      let claimed: number;
      try {
        const [claim] = await deps.runAtomic([
          sql`
            WITH files AS (
              SELECT * FROM jsonb_to_recordset(${files}::jsonb)
                AS f(doc_id uuid, path text, doc_version int, blob_sha text)
            ),
            live AS (
              -- Every doc must still be live in this project and at the exported version
              -- or later (the PR carries what was exported; a later edit shows as
              -- "Changed in HQ").
              SELECT d.id FROM docs d JOIN files f ON f.doc_id = d.id
              WHERE d.project_id = ${projectId}::uuid AND d.deleted_at IS NULL
                AND d.version >= f.doc_version
            ),
            pub AS (
              INSERT INTO handbook_publications (id, project_id, branch, state, created_by)
              SELECT ${publicationId}::uuid, ${projectId}::uuid, ${branch}, 'open', ${actorId}::uuid
              WHERE (SELECT count(*) FROM live) = (SELECT count(*) FROM files)
              RETURNING id
            ),
            claimed AS (
              INSERT INTO handbook_publication_docs (publication_id, doc_id, path, doc_version,
                blob_sha)
              SELECT pub.id, f.doc_id, f.path, f.doc_version, f.blob_sha FROM files f, pub
              RETURNING doc_id
            ),
            pinned AS (
              -- One doc per file (index): the path is stored on first publish, so a later
              -- title change never moves the file.
              UPDATE docs SET handbook_path = f.path
              FROM files f
              WHERE docs.id = f.doc_id AND EXISTS (SELECT 1 FROM pub)
                AND docs.handbook_path IS DISTINCT FROM f.path
                AND coalesce(docs.handbook_path, docs.source_path) IS DISTINCT FROM f.path
            )
            SELECT (SELECT count(*) FROM claimed)::int AS claimed
          `,
        ]);
        claimed = rowsOf(claim, z.object({ claimed: z.number() }))[0]?.claimed ?? 0;
      } catch (error) {
        const info = pgErrorInfo(error);
        if (info?.code === UNIQUE_VIOLATION) {
          if (info.constraint === "handbook_publication_docs_one_open_per_doc") {
            const url = await openPrFor(toPublish.map((item) => item.row.id));
            throw conflict(url ? `Already in an open PR: ${url}` : "Already being published");
          }
          if (info.constraint === "docs_project_handbook_file_unique") {
            throw conflict("Another doc already uses one of these paths");
          }
        }
        throw error;
      }
      if (claimed !== toPublish.length) {
        throw conflict("A doc changed or was deleted meanwhile; try again");
      }

      // 4. GitHub. Anything that fails marks the publication failed (5).
      let branchAttempted = false;
      try {
        // A timed-out create may still have made the branch, so it counts from the attempt.
        branchAttempted = true;
        await github.createBranch(branch, main.sha);
        const message = [
          "docs: publish from Stockkart HQ",
          "",
          ...toPublish.map((item) => `- ${item.path}: ${item.row.title} (HQ v${item.row.version})`),
          "",
          // Lets the push webhook recognise this commit (and its merge) as HQ's own.
          `HQ-Publication: ${branch}`,
        ].join("\n");
        const committed = await github.commitFiles(
          branch,
          toPublish.map((item) => ({ path: item.path, content: item.markdown })),
          message,
        );
        for (const blob of committed.blobs) {
          const item = toPublish.find((candidate) => candidate.path === blob.path);
          if (!item || item.sha !== blob.sha || !GIT_SHA_PATTERN.test(blob.sha)) {
            throw new HandbookGithubError("blob_mismatch");
          }
        }
        const n = toPublish.length;
        const pr = await github.openPullRequest(
          branch,
          main.name,
          `Publish from Stockkart HQ: ${n} ${n === 1 ? "doc" : "docs"}`,
          [
            "Published from Stockkart HQ:",
            "",
            ...toPublish.map(
              (item) => `- \`${item.path}\`: ${item.row.title} (HQ version ${item.row.version})`,
            ),
            "",
            "This pull request was generated by Stockkart HQ. Edit the docs in HQ and publish " +
              "again rather than pushing to this branch; HQ marks them as synced when it is merged.",
          ].join("\n"),
        );
        const meta = JSON.stringify({ pr: pr.number, url: pr.url, branch });
        const [recorded] = await deps.runAtomic([
          sql`
            WITH pub AS (
              UPDATE handbook_publications SET pr_number = ${pr.number}::int,
                pr_url = ${pr.url}, updated_at = now()
              WHERE id = ${publicationId}::uuid AND state = 'open'
              RETURNING id
            ),
            logged AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value,
                meta)
              SELECT 'doc', pd.doc_id, ${actorId}::uuid, 'handbook_published', 'handbook',
                ${String(pr.number)}, ${meta}::jsonb || jsonb_build_object('path', pd.path,
                  'version', pd.doc_version)
              FROM handbook_publication_docs pd JOIN pub ON pub.id = pd.publication_id
            )
            SELECT count(*)::int AS recorded FROM pub
          `,
        ]);
        if ((rowsOf(recorded, z.object({ recorded: z.number() }))[0]?.recorded ?? 0) === 0) {
          throw new HandbookGithubError("record_failed");
        }
        outcome.pr = pr;
        outcome.published = toPublish.map((item) => ({
          docId: item.row.id,
          title: item.row.title,
          path: item.path,
        }));
        return outcome;
      } catch (error) {
        const code =
          error instanceof HandbookGithubError
            ? error.code
            : error instanceof HandbookNotConfigured
              ? "not_configured"
              : "internal";
        // The paths pinned by the claim go back to what they were (unless edited since).
        const pins = JSON.stringify(
          toPublish.map((item) => ({
            id: item.row.id,
            path: item.path,
            previous: item.row.handbookPath,
          })),
        );
        try {
          await db.execute(sql`
            WITH failed AS (
              UPDATE handbook_publications SET state = 'failed', error_code = ${code},
                updated_at = now()
              WHERE id = ${publicationId}::uuid AND state = 'open'
              RETURNING id
            )
            UPDATE docs SET handbook_path = r.previous
            FROM jsonb_to_recordset(${pins}::jsonb) AS r(id uuid, path text, previous text)
            WHERE docs.id = r.id AND docs.handbook_path = r.path
              AND r.previous IS DISTINCT FROM r.path AND EXISTS (SELECT 1 FROM failed)
          `);
        } catch {
          // Keep the original error; the claim is then failed as abandoned after 15 min.
        }
        const leftover = branchAttempted
          ? ` The branch ${branch} may remain on GitHub; delete it there.`
          : "";
        if (code === "internal") throw error;
        throw invalid(`Publishing failed (${code}).${leftover}`);
      }
    },
  };
}

export type HandbookPublishService = ReturnType<typeof createHandbookPublishService>;
