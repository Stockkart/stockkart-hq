import { sql } from "drizzle-orm";
import { z } from "zod";

import { GIT_NULL_SHA } from "@/lib/handbook/constants";
import { type AppDatabase } from "@/server/db/types";
import { type DeliveryPlan } from "@/server/github/plan";

import { watcherStatusNotifications } from "./notifications";
import { rowsOf } from "./sql";

/** GH-3: the default done status is the first done-category status that is not this one. */
const WONT_DO = "Won't Do";

/** Deliveries are remembered this long for dedupe (GitHub offers redelivery of recent ones). */
const DELIVERY_RETENTION = "30 days";

export interface DeliveryResult {
  /** The delivery id was seen before: nothing was written. */
  duplicate: boolean;
  /** New `github_refs` rows. */
  linked: number;
  /** Existing PR rows whose state or title was updated. */
  updated: number;
  /** Issues moved to the done status (GH-3). */
  moved: number;
  /** DOC-14: handbook publications and docs whose sync state changed. */
  handbook?: number;
}

const resultRow = z.object({
  fresh: z.number(),
  linked: z.number(),
  updated: z.number(),
  moved: z.number(),
  handbook: z.number(),
});

/**
 * Applies a webhook delivery (GH-1…GH-3). Everything, the dedupe record included, is ONE
 * statement, so it commits or rolls back as a whole on any driver (Neon HTTP has no
 * interactive transactions): a failed delivery leaves no dedupe row, so GitHub's redelivery
 * applies it again, and a redelivery of an applied one changes nothing.
 *
 *   delivery         records X-GitHub-Delivery; empty when already recorded → every other
 *                    write below is gated on it (redelivery dedupe; the delivery id is not
 *                    signed, so it is NOT replay protection: the rules below are each
 *                    idempotent on their own)
 *   planned          the plan's refs joined to the live issues they name (unknown keys drop)
 *   linked_*         upsert one row per (issue, repo, kind, number | sha | branch); PR rows
 *                    ignore events older than the stored `github_updated_at`, and a merged
 *                    PR stays merged
 *   pr_updated       the PR's new state and title on rows linked by earlier events
 *   merge_once       GH-3 once per merged PR: records (repo, number); empty when recorded
 *   locked → moved   only when merge_once inserted: row-lock (in id order) the issues the
 *                    merged PR closes, move each one not yet in a done-category status to
 *                    the project's done status, and log it
 *   moved_notified   tell the moved issues' watchers (NTF-1), deduped by the activity row
 *   hb_*             DOC-14, handbook repo only (`plan.handbook`): a merged / closed `hq/…`
 *                    publication PR (merged → its docs synced to the recorded blobs), or a
 *                    push to the default branch marking the touched docs' remote state
 *
 * The lock is taken by `locked` (SELECT … FOR NO KEY UPDATE) as in `updateIssueField`: a
 * concurrent status change commits first and `locked` sees its result, so "already done" is
 * judged on the latest status and the activity row records the real from → to.
 */
export function createGithubService(db: AppDatabase) {
  return {
    async applyDelivery(plan: DeliveryPlan): Promise<DeliveryResult> {
      const refs = JSON.stringify(
        plan.refs.map((ref) => ({
          project_key: ref.issue.projectKey,
          num: ref.issue.number,
          kind: ref.kind,
          number: ref.number,
          sha: ref.sha,
          ref_name: ref.refName,
          title: ref.title,
          url: ref.url,
          state: ref.state,
          author_login: ref.authorLogin,
          merged_at: ref.mergedAt,
          github_updated_at: ref.githubUpdatedAt,
        })),
      );
      const pr = plan.pullRequest;
      const prUpdatedAt = pr?.githubUpdatedAt ?? null;
      const closes = JSON.stringify(
        (plan.closes?.issues ?? []).map((ref) => ({
          project_key: ref.projectKey,
          num: ref.number,
        })),
      );
      const meta = JSON.stringify({
        source: "github",
        repo: plan.repo,
        pr: plan.closes?.pr ?? null,
        mergedBy: plan.closes?.mergedBy ?? null,
      });
      const fresh = sql`EXISTS (SELECT 1 FROM delivery)`;
      // DOC-14 handbook repo deliveries (empty for every other repo).
      const hbPr = plan.handbook?.pullRequest ?? null;
      const hbPaths = JSON.stringify(plan.handbook?.paths ?? []);

      const result = await db.execute(sql`
        WITH delivery AS (
          INSERT INTO github_deliveries (delivery_id, event)
          VALUES (${plan.deliveryId}, ${plan.event})
          ON CONFLICT (delivery_id) DO NOTHING
          RETURNING delivery_id
        ),
        pruned AS (
          DELETE FROM github_deliveries
          WHERE received_at < now() - ${DELIVERY_RETENTION}::interval AND ${fresh}
        ),
        planned AS (
          SELECT i.id AS issue_id, r.kind::github_ref_kind AS kind, r.number, r.sha, r.ref_name,
            r.title, r.url, r.state::github_pr_state AS state, r.author_login, r.merged_at,
            r.github_updated_at
          FROM jsonb_to_recordset(${refs}::jsonb) AS r(project_key text, num int, kind text,
            number int, sha text, ref_name text, title text, url text, state text,
            author_login text, merged_at timestamptz, github_updated_at timestamptz)
          JOIN projects p ON p.key = r.project_key AND p.archived_at IS NULL
          JOIN issues i ON i.project_id = p.id AND i.number = r.num AND i.deleted_at IS NULL
          WHERE ${fresh}
        ),
        linked_branches AS (
          INSERT INTO github_refs (issue_id, repo, kind, ref_name, title, url)
          SELECT issue_id, ${plan.repo}, kind, ref_name, title, url
          FROM planned WHERE kind = 'branch'
          ON CONFLICT (issue_id, repo, kind, ref_name) WHERE kind = 'branch' DO NOTHING
          RETURNING id
        ),
        linked_commits AS (
          -- A commit already linked (pushed again to another branch, or merged) is skipped.
          INSERT INTO github_refs (issue_id, repo, kind, sha, title, url, author_login)
          SELECT issue_id, ${plan.repo}, kind, sha, title, url, author_login
          FROM planned WHERE kind = 'commit'
          ON CONFLICT (issue_id, repo, kind, sha) WHERE kind = 'commit' DO NOTHING
          RETURNING id
        ),
        linked_prs AS (
          INSERT INTO github_refs (issue_id, repo, kind, number, ref_name, title, url, state,
            author_login, merged_at, github_updated_at)
          SELECT issue_id, ${plan.repo}, kind, number, ref_name, title, url, state,
            author_login, merged_at, github_updated_at
          FROM planned WHERE kind = 'pr'
          ON CONFLICT (issue_id, repo, kind, number) WHERE kind = 'pr' DO UPDATE SET
            ref_name = EXCLUDED.ref_name, title = EXCLUDED.title, url = EXCLUDED.url,
            -- A merged PR cannot be reopened: a late event never un-merges it.
            state = CASE WHEN github_refs.state = 'merged' THEN github_refs.state
              ELSE EXCLUDED.state END,
            author_login = COALESCE(EXCLUDED.author_login, github_refs.author_login),
            merged_at = COALESCE(EXCLUDED.merged_at, github_refs.merged_at),
            github_updated_at = GREATEST(EXCLUDED.github_updated_at, github_refs.github_updated_at),
            updated_at = now()
          -- GitHub does not deliver in order: an older event leaves a newer state alone.
          WHERE EXCLUDED.github_updated_at IS NULL OR github_refs.github_updated_at IS NULL
            OR EXCLUDED.github_updated_at >= github_refs.github_updated_at
          RETURNING id, (xmax = 0) AS inserted
        ),
        pr_updated AS (
          -- Rows of this PR for issues it no longer mentions (e.g. after a title edit); the
          -- rows upserted above are excluded, so no row is written twice. Same ordering rules.
          UPDATE github_refs SET title = ${pr?.title ?? null}::text, url = ${pr?.url ?? null}::text,
            state = CASE WHEN state = 'merged' THEN state
              ELSE ${pr?.state ?? null}::github_pr_state END,
            ref_name = ${pr?.headRef ?? null}::text,
            merged_at = COALESCE(${pr?.mergedAt ?? null}::timestamptz, merged_at),
            github_updated_at = GREATEST(${prUpdatedAt}::timestamptz, github_updated_at),
            updated_at = now()
          WHERE ${pr !== null}::boolean AND ${fresh} AND kind = 'pr' AND repo = ${plan.repo}
            AND number = ${pr?.number ?? null}::int
            AND issue_id NOT IN (SELECT issue_id FROM planned WHERE kind = 'pr')
            AND (${prUpdatedAt}::timestamptz IS NULL OR github_updated_at IS NULL
              OR ${prUpdatedAt}::timestamptz >= github_updated_at)
          RETURNING id
        ),
        merge_once AS (
          -- GH-3 runs once per merge, not once per delivery: a replayed or late redelivered
          -- merge (new delivery id, same signed body) must not re-close an issue someone
          -- reopened. A concurrent duplicate waits on the primary key, then inserts nothing.
          INSERT INTO github_pr_merges (repo, number)
          SELECT ${plan.repo}, ${plan.closes?.pr ?? null}::int
          WHERE ${plan.closes !== null}::boolean AND ${fresh}
          ON CONFLICT (repo, number) DO NOTHING
          RETURNING 1
        ),
        closing AS (
          SELECT DISTINCT i.id
          FROM jsonb_to_recordset(${closes}::jsonb) AS r(project_key text, num int)
          JOIN projects p ON p.key = r.project_key AND p.archived_at IS NULL
          JOIN issues i ON i.project_id = p.id AND i.number = r.num AND i.deleted_at IS NULL
          WHERE EXISTS (SELECT 1 FROM merge_once)
        ),
        locked AS (
          -- In id order, so two merges closing the same issues cannot deadlock. NO KEY: the
          -- update below changes no key column, so github_refs FK checks are not blocked.
          SELECT id, project_id, status_id FROM issues
          WHERE id IN (SELECT id FROM closing) AND deleted_at IS NULL
          ORDER BY id
          FOR NO KEY UPDATE
        ),
        done_status AS (
          SELECT DISTINCT ON (project_id) project_id, id
          FROM statuses
          WHERE category = 'done' AND name <> ${WONT_DO}
            AND project_id IN (SELECT project_id FROM locked)
          ORDER BY project_id, position, id
        ),
        moved AS (
          UPDATE issues SET status_id = done_status.id,
            resolved_at = COALESCE(issues.resolved_at, now()), updated_at = now()
          FROM locked JOIN done_status ON done_status.project_id = locked.project_id
          WHERE issues.id = locked.id
            AND (SELECT category FROM statuses WHERE id = locked.status_id) <> 'done'
          RETURNING issues.id, locked.status_id::text AS from_value,
            issues.status_id::text AS to_value
        ),
        moved_activity AS (
          -- GH-3: no HQ actor; who merged it is in meta for the Activity tab.
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value, meta)
          SELECT 'issue', id, NULL, 'updated', 'status', from_value, to_value, ${meta}::jsonb
          FROM moved
          RETURNING id, entity_id, from_value, to_value
        ),
        moved_notified AS (
          -- NTF-1: the watchers of each moved issue; no actor, so the bell says "GitHub".
          ${watcherStatusNotifications(null, sql`moved_activity`, sql`'{"source":"github"}'::jsonb`)}
        ),
        hb_merged AS (
          -- DOC-14: HQ's publication PR merged into the handbook's default branch. Matched
          -- by branch (unique, hq/...) and number. Also a publication recorded failed whose
          -- PR was opened anyway (a timed-out request): it gets the PR from the payload.
          -- A redelivery or a late event is a no-op (merged / closed rows do not match).
          UPDATE handbook_publications SET state = 'merged',
            merged_at = COALESCE(${hbPr?.mergedAt ?? null}::timestamptz, now()),
            pr_number = ${hbPr?.number ?? null}::int, pr_url = ${hbPr?.url ?? null}::text,
            error_code = NULL, updated_at = now()
          WHERE ${hbPr?.outcome === "merged"}::boolean AND ${fresh}
            AND state IN ('open', 'failed') AND branch = ${hbPr?.branch ?? null}::text
            AND (pr_number IS NULL OR pr_number = ${hbPr?.number ?? null}::int)
          RETURNING id, pr_number, merged_at
        ),
        hb_closed AS (
          UPDATE handbook_publications SET state = 'closed',
            pr_number = ${hbPr?.number ?? null}::int, pr_url = ${hbPr?.url ?? null}::text,
            error_code = NULL, updated_at = now()
          WHERE ${hbPr?.outcome === "closed"}::boolean AND ${fresh}
            AND state IN ('open', 'failed') AND branch = ${hbPr?.branch ?? null}::text
            AND (pr_number IS NULL OR pr_number = ${hbPr?.number ?? null}::int)
          RETURNING id
        ),
        hb_synced AS (
          -- The merged files are what HQ exported: blob, version and time in ONE update. The
          -- handbook side is that blob too, unless someone else pushed to the PR branch (not
          -- a clean one-commit PR: blob unknown) or a later push already marked the file
          -- (GitHub does not order deliveries; keep the newer marker).
          UPDATE docs SET handbook_blob_sha = pd.blob_sha,
            handbook_synced_version = pd.doc_version, handbook_synced_at = now(),
            handbook_remote_sha = CASE
              WHEN NOT ${hbPr?.cleanMerge ?? false}::boolean THEN NULL
              WHEN docs.handbook_remote_seen_at > m.merged_at THEN docs.handbook_remote_sha
              ELSE pd.blob_sha END,
            handbook_remote_seen_at = CASE
              WHEN ${hbPr?.cleanMerge ?? false}::boolean
                AND docs.handbook_remote_seen_at > m.merged_at THEN docs.handbook_remote_seen_at
              ELSE now() END
          FROM handbook_publication_docs pd JOIN hb_merged m ON m.id = pd.publication_id
          WHERE docs.id = pd.doc_id AND pd.blob_sha IS NOT NULL AND docs.deleted_at IS NULL
            AND pd.doc_version <= docs.version
            -- An older publication landing late never moves the sync back.
            AND (docs.handbook_synced_version IS NULL
              OR pd.doc_version >= docs.handbook_synced_version)
          RETURNING docs.id, m.pr_number
        ),
        hb_synced_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value, meta)
          SELECT 'doc', id, NULL, 'handbook_merged', 'handbook', pr_number::text, ${meta}::jsonb
          FROM hb_synced
        ),
        hb_paths AS (
          SELECT r.path, r.removed, r.branches
          FROM jsonb_to_recordset(${hbPaths}::jsonb) AS r(path text, removed boolean, branches jsonb)
          WHERE ${fresh}
        ),
        hb_marked AS (
          -- DOC-14: a push to the handbook's default branch touched these files. Which doc
          -- owns a file is coalesce(handbook_path, source_path) (the unique index). NULL sha =
          -- "changed, blob unknown"; the null object id = removed. HQ's own publication
          -- landing (every commit names its branch) is left to hb_synced.
          UPDATE docs SET handbook_remote_sha = CASE WHEN r.removed THEN ${GIT_NULL_SHA}::text END,
            handbook_remote_seen_at = now()
          FROM hb_paths r
          WHERE docs.deleted_at IS NULL
            AND lower(coalesce(docs.handbook_path, docs.source_path)) = lower(r.path)
            AND NOT EXISTS (
              SELECT 1 FROM handbook_publication_docs pd
              JOIN handbook_publications p ON p.id = pd.publication_id
              WHERE pd.doc_id = docs.id AND lower(pd.path) = lower(r.path)
                AND r.branches @> to_jsonb(p.branch)
                -- Only while it can still be landing: open, or merged within the hour (the
                -- push and the pull_request event arrive in either order). An old branch
                -- named in a later commit message hides nothing.
                AND (p.state = 'open'
                  OR (p.state = 'merged' AND p.merged_at > now() - interval '1 hour'))
            )
          RETURNING docs.id
        )
        SELECT
          (SELECT count(*) FROM delivery)::int AS fresh,
          ((SELECT count(*) FROM linked_branches) + (SELECT count(*) FROM linked_commits)
            + (SELECT count(*) FROM linked_prs WHERE inserted))::int AS linked,
          ((SELECT count(*) FROM linked_prs WHERE NOT inserted)
            + (SELECT count(*) FROM pr_updated))::int AS updated,
          (SELECT count(*) FROM moved)::int AS moved,
          ((SELECT count(*) FROM hb_merged) + (SELECT count(*) FROM hb_closed)
            + (SELECT count(*) FROM hb_synced) + (SELECT count(*) FROM hb_marked))::int AS handbook
      `);
      const [row] = rowsOf(result, resultRow);
      if (!row) throw new Error("applyDelivery returned no row");
      return {
        duplicate: row.fresh === 0,
        linked: row.linked,
        updated: row.updated,
        moved: row.moved,
        handbook: row.handbook,
      };
    },
  };
}

export type GithubService = ReturnType<typeof createGithubService>;
