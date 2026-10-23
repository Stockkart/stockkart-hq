import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { GIT_NULL_SHA, type HandbookSyncStatus } from "@/lib/handbook/constants";
import { rt } from "@/lib/rich-text";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import {
  activity,
  docs,
  docVersions,
  handbookPublicationDocs,
  handbookPublications,
  projects,
} from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { gitBlobSha } from "@/server/handbook/git-blob";
import { createGithubWebhookHandler } from "@/server/github/webhook";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { pullRequestPayload, pushPayload, sha, webhookRequest } from "@/test/github-fixtures";
import { FAKE_HANDBOOK_REPO, fakeHandbookRepo } from "@/test/handbook-fakes";
import { appLayoutReads } from "@/test/page-reads";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createFileQueries } from "./files";
import { createGithubService } from "./github";
import { createHandbookPublishService, DRIFT_MESSAGE, REMOVED_MESSAGE } from "./handbook-publish";
import { CHECK_RATE_LIMITED_MESSAGE, createHandbookPullService } from "./handbook-pull";
import { createHandbookQueries } from "./handbook-queries";
import { createIssueQueries } from "./issue-queries";
import { createImportQueries } from "./imports";
import { createSettingsQueries } from "./settings-queries";
import { projectIdByKey } from "./sql";

/**
 * DOC-14 two-way sync against Postgres: publish → PR → merge webhook → push webhooks → pull,
 * check and import, with an in-memory repo instead of GitHub (never the network).
 */
describeDb("handbook sync (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let projectId: string;
  let repo: ReturnType<typeof fakeHandbookRepo>;

  const docService = () => createDocService(db, { runAtomic: transactionRunner(db) });
  const publishService = () =>
    createHandbookPublishService(db, {
      runAtomic: transactionRunner(db),
      github: repo.github,
      now: () => new Date("2026-05-01T10:00:00Z"),
    });
  const pullService = () =>
    createHandbookPullService(db, { runAtomic: transactionRunner(db), github: repo.github });
  const queries = () => createHandbookQueries(db);
  const webhook = () =>
    createGithubWebhookHandler({
      secret: () => "test-webhook-secret-not-used-anywhere-real",
      apply: (plan) => createGithubService(db).applyDelivery(plan),
      refresh: () => undefined,
      handbookRepo: () => FAKE_HANDBOOK_REPO,
      log: () => undefined,
    });

  async function newDoc(title: string, text: string, type: "page" | "runbook" = "page") {
    const created = await docService().createDoc(actor, { projectKey: "STK", title, type });
    return edit(created.id, created.version, text);
  }

  async function edit(id: string, baseVersion: number, text: string) {
    const saved = await docService().saveDoc(actor, {
      docId: id,
      baseVersion,
      content: rt.doc(rt.paragraph(text)),
      snapshot: false,
    });
    if (saved.status !== "saved") throw new Error("save conflicted");
    return { id, version: saved.version };
  }

  async function sync(id: string) {
    const value = await queries().docSync(projectIdByKey("STK"), id);
    if (!value) throw new Error("no sync row");
    return value;
  }
  const status = async (id: string): Promise<HandbookSyncStatus> => (await sync(id)).status;

  async function publicationOf(docId: string) {
    const [row] = await db
      .select({
        id: handbookPublications.id,
        state: handbookPublications.state,
        branch: handbookPublications.branch,
        prNumber: handbookPublications.prNumber,
        prUrl: handbookPublications.prUrl,
        errorCode: handbookPublications.errorCode,
        blobSha: handbookPublicationDocs.blobSha,
        docVersion: handbookPublicationDocs.docVersion,
      })
      .from(handbookPublicationDocs)
      .innerJoin(
        handbookPublications,
        eq(handbookPublications.id, handbookPublicationDocs.publicationId),
      )
      .where(eq(handbookPublicationDocs.docId, docId))
      .orderBy(sql`${handbookPublications.createdAt} DESC`)
      .limit(1);
    return row;
  }

  function handbookCommit(
    message: string,
    files: { added?: string[]; modified?: string[]; removed?: string[] },
  ) {
    const id = sha();
    return {
      id,
      message,
      url: `https://github.com/${FAKE_HANDBOOK_REPO}/commit/${id}`,
      ...files,
    };
  }

  async function deliver(event: string, payload: unknown) {
    const response = await webhook()(webhookRequest(event, payload));
    expect(response.status).toBe(200);
    return response.json();
  }

  async function merge(docId: string, options: { commits?: number } = {}) {
    const pub = await publicationOf(docId);
    if (!pub?.prNumber) throw new Error("no PR");
    await deliverMerge(pub.branch, pub.prNumber, options);
    return pub;
  }

  async function deliverMerge(branch: string, number: number, options: { commits?: number } = {}) {
    const payload = pullRequestPayload({
      repo: FAKE_HANDBOOK_REPO,
      number,
      head: branch,
      action: "closed",
      state: "closed",
      merged: true,
    });
    await deliver("pull_request", {
      ...payload,
      pull_request: {
        ...payload.pull_request,
        // HQ's PR has one commit; GitHub sends the count with every pull_request event.
        commits: options.commits ?? 1,
        merged_at: new Date().toISOString(),
      },
    });
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("no STK");
    projectId = project.id;
  });

  beforeEach(() => {
    repo = fakeHandbookRepo();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("blocks a publish whose markdown looks like it holds a secret, before any GitHub call", async () => {
    const doc = await newDoc("Ops secrets", "Log in with password=hunter2-very-secret please");
    await expect(
      publishService().publish(actor, {
        projectKey: "STK",
        docIds: [doc.id],
        overwrite: [],
        acknowledgedPublic: true,
        confirmSpecialPath: false,
      }),
    ).rejects.toThrow(/looks like a password, token or key.*public/);
    expect(repo.calls).toEqual([]);
    expect(await publicationOf(doc.id)).toBeUndefined();
    const preview = await publishService().preview(actor, { docId: doc.id });
    expect(preview.secret).toMatch(/looks like a password/);
  });

  it("publishes several docs as ONE commit in ONE PR, records it and logs activity", async () => {
    const a = await newDoc("Runbook", "Restart it.");
    const b = await newDoc("Architecture", "Boxes and arrows.");
    const outcome = await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [a.id, b.id],
      overwrite: [],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    const prNumber = outcome.pr?.number ?? 0;
    expect(outcome.pr).toEqual({
      number: prNumber,
      url: `https://github.com/${FAKE_HANDBOOK_REPO}/pull/${prNumber}`,
    });
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0]?.paths).toEqual(["RUNBOOK.md", "ARCHITECTURE.md"]);
    expect(repo.commits[0]?.message).toMatch(/^docs: publish from Stockkart HQ\n/);
    const branch = repo.branches[0] ?? "";
    expect(branch).toMatch(/^hq\/publish-20260501-[0-9a-f]{8}$/);
    expect(repo.commits[0]?.message).toContain(`HQ-Publication: ${branch}`);
    expect(repo.prs[0]).toMatchObject({
      head: branch,
      base: "main",
      title: "Publish from Stockkart HQ: 2 docs",
    });
    expect(repo.prs[0]?.body).toContain("generated by Stockkart HQ");
    expect(repo.prs[0]?.body).toContain(`HQ version ${a.version}`);

    const pub = await publicationOf(a.id);
    expect(pub).toMatchObject({
      state: "open",
      branch,
      prNumber,
      docVersion: a.version,
      blobSha: gitBlobSha("# Runbook\n\nRestart it.\n"),
    });
    const [row] = await db.select({ path: docs.handbookPath }).from(docs).where(eq(docs.id, a.id));
    expect(row?.path).toBe("RUNBOOK.md");
    const logged = await db
      .select({ toValue: activity.toValue, meta: activity.meta })
      .from(activity)
      .where(and(eq(activity.entityId, a.id), eq(activity.action, "handbook_published")));
    expect(logged).toEqual([
      {
        toValue: String(prNumber),
        meta: expect.objectContaining({ pr: prNumber, path: "RUNBOOK.md" }),
      },
    ]);
    expect(await sync(a.id)).toMatchObject({ status: "pr_open", pr: { number: prNumber } });

    // One open PR per doc.
    await expect(
      publishService().publish(actor, {
        projectKey: "STK",
        docIds: [a.id],
        overwrite: [],
        acknowledgedPublic: true,
        confirmSpecialPath: false,
      }),
    ).rejects.toThrow(
      `Already in an open PR: https://github.com/${FAKE_HANDBOOK_REPO}/pull/${prNumber}`,
    );

    // Merged: the publication is merged and both docs are in sync, without an API call.
    const callsBefore = repo.calls.length;
    await merge(a.id);
    expect((await publicationOf(a.id))?.state).toBe("merged");
    expect(await status(a.id)).toBe("in_sync");
    expect(await status(b.id)).toBe("in_sync");
    expect(repo.calls.length).toBe(callsBefore);
    const [synced] = await db
      .select({
        blob: docs.handbookBlobSha,
        version: docs.handbookSyncedVersion,
        remote: docs.handbookRemoteSha,
      })
      .from(docs)
      .where(eq(docs.id, a.id));
    expect(synced).toEqual({
      blob: gitBlobSha("# Runbook\n\nRestart it.\n"),
      version: a.version,
      remote: gitBlobSha("# Runbook\n\nRestart it.\n"),
    });

    // The push of that merge (commits naming the branch) does not mark drift.
    await deliver(
      "push",
      pushPayload({
        repo: FAKE_HANDBOOK_REPO,
        commits: [
          handbookCommit(`docs: publish from Stockkart HQ\n\nHQ-Publication: ${branch}`, {
            added: ["RUNBOOK.md", "ARCHITECTURE.md"],
          }),
          handbookCommit(`Merge pull request #${prNumber} from Stockkart/${branch}`, {
            added: ["RUNBOOK.md", "ARCHITECTURE.md"],
          }),
        ],
      }),
    );
    expect(await status(a.id)).toBe("in_sync");
  });

  it("marks drift and removals from a person's push; other repos and branches change nothing", async () => {
    const doc = await newDoc("Onboarding", "Welcome.");
    const other = await newDoc("Glossary", "Words.");
    await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [doc.id, other.id],
      overwrite: [],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    await merge(doc.id);
    expect(await status(doc.id)).toBe("in_sync");

    // Another repo with the same path, and a feature branch of the handbook: no effect.
    await deliver(
      "push",
      pushPayload({
        repo: "Stockkart/inventory-api",
        commits: [
          {
            id: "d".repeat(40),
            message: "edit",
            url: `https://github.com/Stockkart/inventory-api/commit/${"d".repeat(40)}`,
            modified: ["ONBOARDING.md"],
          },
        ],
      }),
    );
    await deliver(
      "push",
      pushPayload({
        repo: FAKE_HANDBOOK_REPO,
        ref: "refs/heads/feature",
        commits: [handbookCommit("wip", { modified: ["ONBOARDING.md"] })],
      }),
    );
    expect(await status(doc.id)).toBe("in_sync");

    await deliver(
      "push",
      pushPayload({
        repo: FAKE_HANDBOOK_REPO,
        commits: [
          handbookCommit("Clarify onboarding", { modified: ["onboarding.md"] }),
          handbookCommit("Drop the glossary", { removed: ["GLOSSARY.md"] }),
        ],
      }),
    );
    expect(await status(doc.id)).toBe("changed_in_handbook");
    expect(await status(other.id)).toBe("removed_in_handbook");
    const [row] = await db
      .select({ remote: docs.handbookRemoteSha, seen: docs.handbookRemoteSeenAt })
      .from(docs)
      .where(eq(docs.id, doc.id));
    expect(row?.remote).toBeNull();
    expect(row?.seen).toBeInstanceOf(Date);

    // HQ edits too: both changed.
    const [current] = await db
      .select({ version: docs.version })
      .from(docs)
      .where(eq(docs.id, doc.id));
    await edit(doc.id, current?.version ?? 0, "Welcome, HQ edit.");
    expect(await status(doc.id)).toBe("both_changed");
  });

  it("closes an unmerged publication without touching its docs", async () => {
    const doc = await newDoc("Postmortem guide", "Write it.");
    await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [doc.id],
      overwrite: [],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    const pub = await publicationOf(doc.id);
    await deliver(
      "pull_request",
      pullRequestPayload({
        repo: FAKE_HANDBOOK_REPO,
        number: pub?.prNumber ?? 0,
        head: pub?.branch ?? "",
        action: "closed",
        state: "closed",
      }),
    );
    expect((await publicationOf(doc.id))?.state).toBe("closed");
    expect(await status(doc.id)).toBe("not_in_handbook");
  });

  it("skips docs equal to the repo file, refuses drift unless the reviewed blob is overwritten", async () => {
    const same = await newDoc("Same file", "Identical.");
    repo.files.set("SAME_FILE.md", "# Same file\n\nIdentical.\n");
    const outcome = await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [same.id],
      overwrite: [],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    expect(outcome).toMatchObject({ pr: null, unchanged: [{ docId: same.id }] });
    expect(repo.branches).toEqual([]);
    expect(await status(same.id)).toBe("in_sync");

    const drifted = await newDoc("Drifted", "HQ text.");
    const remote = "# Drifted\n\nSomeone else's text.\n";
    repo.files.set("DRIFTED.md", remote);
    await expect(
      publishService().publish(actor, {
        projectKey: "STK",
        docIds: [drifted.id],
        overwrite: [],
        acknowledgedPublic: true,
        confirmSpecialPath: false,
      }),
    ).rejects.toThrow(DRIFT_MESSAGE);
    await expect(
      publishService().publish(actor, {
        projectKey: "STK",
        docIds: [drifted.id],
        overwrite: [{ docId: drifted.id, remoteSha: "f".repeat(40) }],
        acknowledgedPublic: true,
        confirmSpecialPath: false,
      }),
    ).rejects.toThrow(DRIFT_MESSAGE);
    const preview = await publishService().preview(actor, { docId: drifted.id });
    expect(preview).toMatchObject({ needsOverwrite: true, unchanged: false });
    expect(preview.remote?.diff.some((hunk) => hunk.kind === "add")).toBe(true);
    const forced = await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [drifted.id],
      overwrite: [{ docId: drifted.id, remoteSha: gitBlobSha(remote) }],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    expect(forced.pr?.number).toBeGreaterThan(100);
  });

  it("maps the one-open-publication index to 'Already in an open PR' on a race", async () => {
    const doc = await newDoc("Raced", "Text.");
    repo.onGetFile(async () => {
      // Another request claimed the doc between the read and the claim.
      const [other] = await db
        .insert(handbookPublications)
        .values({
          projectId,
          branch: "hq/other-request",
          prNumber: 999,
          prUrl: `https://github.com/${FAKE_HANDBOOK_REPO}/pull/999`,
          createdBy: actor,
        })
        .returning({ id: handbookPublications.id });
      await db
        .insert(handbookPublicationDocs)
        .values({ publicationId: other?.id ?? "", docId: doc.id, path: "RACED.md", docVersion: 1 });
      repo.onGetFile(null);
    });
    await expect(
      publishService().publish(actor, {
        projectKey: "STK",
        docIds: [doc.id],
        overwrite: [],
        acknowledgedPublic: true,
        confirmSpecialPath: false,
      }),
    ).rejects.toThrow(`Already in an open PR: https://github.com/${FAKE_HANDBOOK_REPO}/pull/999`);
    expect(repo.branches).toEqual([]);
    await db
      .update(handbookPublications)
      .set({ state: "closed" })
      .where(eq(handbookPublications.branch, "hq/other-request"));
  });

  it("records a failed publication (short code, branch noted) and frees the doc", async () => {
    const doc = await newDoc("Fails once", "Text.");
    repo.failAt("openPullRequest", "github_422");
    await expect(
      publishService().publish(actor, {
        projectKey: "STK",
        docIds: [doc.id],
        overwrite: [],
        acknowledgedPublic: true,
        confirmSpecialPath: false,
      }),
    ).rejects.toThrow(/Publishing failed \(github_422\)\. The branch hq\/publish-\S+ may remain/);
    expect(await publicationOf(doc.id)).toMatchObject({
      state: "failed",
      errorCode: "github_422",
      prNumber: null,
    });
    const logged = await db
      .select({ id: activity.id })
      .from(activity)
      .where(and(eq(activity.entityId, doc.id), eq(activity.action, "handbook_published")));
    expect(logged).toEqual([]);

    // Failing before the PR request puts the pinned path back.
    const early = await newDoc("Fails early", "Text.");
    repo.failAt("commitFiles", "github_409");
    await expect(publish([early.id])).rejects.toThrow(/Publishing failed \(github_409\)/);
    const [unpinned] = await db
      .select({ path: docs.handbookPath })
      .from(docs)
      .where(eq(docs.id, early.id));
    expect(unpinned?.path).toBeNull();
    repo.failAt(null);
    const retry = await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [doc.id],
      overwrite: [],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    expect(retry.pr).not.toBeNull();
  });

  it("pulls: in sync, repo ahead (clean pull with snapshot + activity), both changed", async () => {
    const doc = await newDoc("Deploying", "Push the button.");
    await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [doc.id],
      overwrite: [],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    await merge(doc.id);
    repo.files.set("DEPLOYING.md", "# Deploying\n\nPush the button.\n");
    expect((await pullService().preview(actor, doc.id)).state).toBe("in_sync");

    // Repo ahead.
    const repoText = "# Deploying\n\nPush the green button.\n";
    repo.files.set("DEPLOYING.md", repoText);
    const ahead = await pullService().preview(actor, doc.id);
    expect(ahead).toMatchObject({ state: "repo_ahead", remoteSha: gitBlobSha(repoText) });
    expect(ahead.diff.map((hunk) => hunk.kind)).toContain("remove");
    // A stale review is refused.
    await expect(
      pullService().apply(actor, {
        docId: doc.id,
        baseVersion: ahead.baseVersion,
        remoteSha: "e".repeat(40),
      }),
    ).rejects.toThrow("The handbook changed again");
    const applied = await pullService().apply(actor, {
      docId: doc.id,
      baseVersion: ahead.baseVersion,
      remoteSha: gitBlobSha(repoText),
    });
    expect(applied.version).toBe(ahead.baseVersion + 1);
    expect(await status(doc.id)).toBe("in_sync");
    const versions = await db
      .select({ version: docVersions.version })
      .from(docVersions)
      .where(eq(docVersions.docId, doc.id));
    expect(versions.map((v) => v.version)).toEqual(
      expect.arrayContaining([ahead.baseVersion, applied.version]),
    );
    const [pulled] = await db
      .select({ toValue: activity.toValue, meta: activity.meta })
      .from(activity)
      .where(and(eq(activity.entityId, doc.id), eq(activity.action, "handbook_pulled")));
    expect(pulled).toEqual({
      toValue: gitBlobSha(repoText).slice(0, 7),
      meta: expect.objectContaining({ sha: gitBlobSha(repoText) }),
    });
    const [row] = await db
      .select({ text: docs.contentText, synced: docs.handbookSyncedVersion })
      .from(docs)
      .where(eq(docs.id, doc.id));
    expect(row).toEqual({ text: "Push the green button.", synced: applied.version });

    // Both changed: take the handbook's; the HQ copy stays in the history.
    await edit(doc.id, applied.version, "HQ wording.");
    const theirs = "# Deploying\n\nHandbook wording.\n";
    repo.files.set("DEPLOYING.md", theirs);
    const both = await pullService().preview(actor, doc.id);
    expect(both.state).toBe("both_changed");
    await pullService().apply(actor, {
      docId: doc.id,
      baseVersion: both.baseVersion,
      remoteSha: gitBlobSha(theirs),
    });
    const [kept] = await db
      .select({ content: docVersions.content })
      .from(docVersions)
      .where(and(eq(docVersions.docId, doc.id), eq(docVersions.version, both.baseVersion)));
    expect(JSON.stringify(kept?.content)).toContain("HQ wording.");
    expect(await status(doc.id)).toBe("in_sync");

    // HQ ahead: nothing to pull.
    const [now] = await db.select({ version: docs.version }).from(docs).where(eq(docs.id, doc.id));
    await edit(doc.id, now?.version ?? 0, "Newer HQ wording.");
    expect((await pullService().preview(actor, doc.id)).state).toBe("hq_ahead");
  });

  it("pulls ADR fields (title, status, superseded by) like the importer", async () => {
    const first = await docService().createAdr(actor, { projectKey: "STK", title: "Use a queue" });
    const second = await docService().createAdr(actor, {
      projectKey: "STK",
      title: "Better queue",
    });
    const path = (await sync(first.id)).path;
    expect(path).toMatch(/^decisions\/\d{4}-use-a-queue\.md$/);
    await publishService().publish(actor, {
      projectKey: "STK",
      docIds: [first.id],
      overwrite: [],
      acknowledgedPublic: true,
      confirmSpecialPath: false,
    });
    await merge(first.id);
    const number = String(second.number).padStart(4, "0");
    const file = `# 9999. Use a durable queue\n\n## Status\n\nSuperseded by [${number}](${number}-better-queue.md).\n\n## Context\n\nNew context.\n`;
    repo.files.set(path, file);
    const preview = await pullService().preview(actor, first.id);
    expect(preview.state).toBe("repo_ahead");
    await pullService().apply(actor, {
      docId: first.id,
      baseVersion: preview.baseVersion,
      remoteSha: gitBlobSha(file),
    });
    const [row] = await db
      .select({
        title: docs.title,
        status: docs.adrStatus,
        by: docs.adrSupersededBy,
        n: docs.adrNumber,
      })
      .from(docs)
      .where(eq(docs.id, first.id));
    expect(row).toEqual({
      title: `${String(first.number).padStart(4, "0")}. Use a durable queue`,
      status: "superseded",
      by: second.id,
      n: first.number,
    });
  });

  it("checks the handbook (rate-limited), baselines matching docs and imports new files", async () => {
    await db.execute(sql`DELETE FROM login_attempts WHERE key LIKE 'handbook_check:%'`);
    // An imported doc (no HQ edits) that matches the repo, and one removed from it.
    const [imported] = await db
      .insert(docs)
      .values({
        projectId,
        title: "Imported page",
        position: "a5",
        content: rt.doc(rt.paragraph("From the import.")),
        contentText: "From the import.",
        sourcePath: "IMPORTED_PAGE.md",
      })
      .returning({ id: docs.id });
    const [gone] = await db
      .insert(docs)
      .values({ projectId, title: "Gone page", position: "a6", sourcePath: "GONE_PAGE.md" })
      .returning({ id: docs.id });
    repo.files.set("IMPORTED_PAGE.md", "# Imported page\n\nFrom the import.\n");
    repo.files.set("NEW_GUIDE.md", "# New guide\n\nHello STK-1.\n");
    repo.files.set(
      "decisions/0099-imported-decision.md",
      "# 0099. Imported decision\n\n## Status\n\nAccepted.\n",
    );
    repo.files.set("decisions/0000-template.md", "# 0000. Template\n");
    repo.files.set("guides/deep.md", "# Deep\n");
    expect(await status(imported?.id ?? "")).toBe("changed_in_handbook");

    const outcome = await pullService().check(actor, "STK");
    expect(outcome.newFiles.map((file) => file.path).sort()).toEqual([
      "NEW_GUIDE.md",
      "decisions/0099-imported-decision.md",
    ]);
    expect(await status(imported?.id ?? "")).toBe("in_sync");
    expect(await status(gone?.id ?? "")).toBe("removed_in_handbook");
    await expect(pullService().check(actor, "STK")).rejects.toThrow(CHECK_RATE_LIMITED_MESSAGE);
    expect(repo.calls.filter((call) => call === "listTree")).toHaveLength(1);

    const created = await pullService().importFile(actor, {
      projectKey: "STK",
      path: "NEW_GUIDE.md",
    });
    const [row] = await db
      .select({
        title: docs.title,
        sourcePath: docs.sourcePath,
        blob: docs.handbookBlobSha,
        version: docs.handbookSyncedVersion,
      })
      .from(docs)
      .where(eq(docs.id, created.id));
    expect(row).toEqual({
      title: "New guide",
      sourcePath: "NEW_GUIDE.md",
      blob: gitBlobSha("# New guide\n\nHello STK-1.\n"),
      version: 1,
    });
    expect(await status(created.id)).toBe("in_sync");
    await expect(
      pullService().importFile(actor, { projectKey: "STK", path: "NEW_GUIDE.md" }),
    ).rejects.toThrow("A doc already maps to NEW_GUIDE.md");

    const adr = await pullService().importFile(actor, {
      projectKey: "STK",
      path: "decisions/0099-imported-decision.md",
    });
    const [adrRow] = await db
      .select({ type: docs.type, n: docs.adrNumber, status: docs.adrStatus })
      .from(docs)
      .where(eq(docs.id, adr.id));
    expect(adrRow).toEqual({ type: "adr", n: 99, status: "accepted" });
    await expect(
      pullService().importFile(actor, { projectKey: "STK", path: "decisions/0000-template.md" }),
    ).rejects.toThrow(/Only top-level files/);
  });

  const publish = (
    docIds: string[],
    extra: {
      confirmSpecialPath?: boolean;
      overwrite?: { docId: string; remoteSha: string }[];
    } = {},
  ) =>
    publishService().publish(actor, {
      projectKey: "STK",
      docIds,
      overwrite: extra.overwrite ?? [],
      acknowledgedPublic: true,
      confirmSpecialPath: extra.confirmSpecialPath ?? false,
    });

  it("review fixes: abandoned claims, unclean merges, late pushes, failed-but-opened PRs", async () => {
    // A claim whose request died 20 minutes ago no longer blocks the doc.
    const stuck = await newDoc("Stuck claim", "Text.");
    const [abandoned] = await db
      .insert(handbookPublications)
      .values({
        projectId,
        branch: "hq/abandoned-claim",
        createdBy: actor,
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      })
      .returning({ id: handbookPublications.id });
    await db.insert(handbookPublicationDocs).values({
      publicationId: abandoned?.id ?? "",
      docId: stuck.id,
      path: "STUCK_CLAIM.md",
      docVersion: 1,
    });
    expect(await status(stuck.id)).toBe("pr_open");
    expect((await publish([stuck.id])).pr).not.toBeNull();
    const [old] = await db
      .select({ state: handbookPublications.state, code: handbookPublications.errorCode })
      .from(handbookPublications)
      .where(eq(handbookPublications.branch, "hq/abandoned-claim"));
    expect(old).toEqual({ state: "failed", code: "abandoned" });

    // Someone pushed to the hq/ branch (2 commits): synced to HQ's export, handbook unknown.
    await merge(stuck.id, { commits: 2 });
    expect(await status(stuck.id)).toBe("changed_in_handbook");

    // A person's push processed before the merge event is not overwritten by it.
    const late = await newDoc("Late push", "Text.");
    await publish([late.id]);
    const latePub = await publicationOf(late.id);
    await deliver(
      "push",
      pushPayload({
        repo: FAKE_HANDBOOK_REPO,
        commits: [handbookCommit("Fix wording", { modified: ["LATE_PUSH.md"] })],
      }),
    );
    // The merge happened before that push (GitHub delivered them out of order).
    const payload = pullRequestPayload({
      repo: FAKE_HANDBOOK_REPO,
      number: latePub?.prNumber ?? 0,
      head: latePub?.branch ?? "",
      action: "closed",
      state: "closed",
      merged: true,
    });
    await deliver("pull_request", {
      ...payload,
      pull_request: {
        ...payload.pull_request,
        commits: 1,
        merged_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(await status(late.id)).toBe("changed_in_handbook");

    // A publication recorded failed whose PR was opened anyway still syncs on merge.
    const timedOut = await newDoc("Timed out", "Text.");
    repo.failAt("openPullRequest", "github_timeout");
    await expect(publish([timedOut.id])).rejects.toThrow(/Publishing failed \(github_timeout\)/);
    repo.failAt(null);
    const failedPub = await publicationOf(timedOut.id);
    expect(failedPub?.state).toBe("failed");
    await deliverMerge(failedPub?.branch ?? "", 4242);
    expect(await publicationOf(timedOut.id)).toMatchObject({
      state: "merged",
      prNumber: 4242,
      errorCode: null,
    });
    expect(await status(timedOut.id)).toBe("in_sync");
  });

  it("review fixes: an old HQ branch named in a later commit hides nothing", async () => {
    const doc = await newDoc("Old branch", "Text.");
    await publish([doc.id]);
    const pub = await merge(doc.id);
    expect(await status(doc.id)).toBe("in_sync");
    await db
      .update(handbookPublications)
      .set({ mergedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(handbookPublications.branch, pub.branch));
    await deliver(
      "push",
      pushPayload({
        repo: FAKE_HANDBOOK_REPO,
        commits: [
          handbookCommit(`Edit\n\nHQ-Publication: ${pub.branch}`, { modified: ["OLD_BRANCH.md"] }),
        ],
      }),
    );
    expect(await status(doc.id)).toBe("changed_in_handbook");

    // A revert of a recent HQ merge is drift too.
    const recent = await newDoc("Reverted", "Text.");
    await publish([recent.id]);
    const recentPub = await merge(recent.id);
    await deliver(
      "push",
      pushPayload({
        repo: FAKE_HANDBOOK_REPO,
        commits: [
          handbookCommit(
            `Revert "Merge pull request #${recentPub.prNumber} from Stockkart/${recentPub.branch}"`,
            {
              removed: ["REVERTED.md"],
            },
          ),
        ],
      }),
    );
    expect(await status(recent.id)).toBe("removed_in_handbook");
  });

  it("review fixes: re-adding a removed file, special paths and pulls during an open PR", async () => {
    const doc = await newDoc("Removed one", "Text.");
    await publish([doc.id]);
    await merge(doc.id);
    // The file is gone from the repo now (the fake starts empty each test).
    await expect(publish([doc.id])).rejects.toThrow(REMOVED_MESSAGE);
    expect((await publishService().preview(actor, { docId: doc.id })).needsOverwrite).toBe(true);
    expect(
      (await publish([doc.id], { overwrite: [{ docId: doc.id, remoteSha: GIT_NULL_SHA }] })).pr,
    ).not.toBeNull();

    // Pull is refused while that PR is open.
    repo.files.set("REMOVED_ONE.md", "# Removed one\n\nOther.\n");
    const preview = await pullService().preview(actor, doc.id);
    await expect(
      pullService().apply(actor, {
        docId: doc.id,
        baseVersion: preview.baseVersion,
        remoteSha: preview.remoteSha ?? "",
      }),
    ).rejects.toThrow("A publish PR is open for this doc");

    const readme = await newDoc("Readme override", "Text.");
    await db.update(docs).set({ handbookPath: "README.md" }).where(eq(docs.id, readme.id));
    await expect(publish([readme.id])).rejects.toThrow(/README\.md has a special meaning/);
    expect((await publish([readme.id], { confirmSpecialPath: true })).pr).not.toBeNull();
  });

  it("doc page and settings page keep ONE round trip with the handbook reads", async () => {
    const doc = await newDoc("Round trips", "Count them.");
    function counted(): { read: Read; trips: () => number } {
      let flushes = 0;
      const read = createBatchedRead(
        () => Promise.reject(new Error("count only: run each query alone")),
        (flush) => {
          flushes += 1;
          setImmediate(flush);
        },
      );
      return { read, trips: () => flushes };
    }
    const stk = projectIdByKey("STK");

    const page = counted();
    const docQueries = createDocQueries(db, { read: page.read });
    const issueQueries = createIssueQueries(db, { read: page.read });
    const results = await Promise.all([
      ...appLayoutReads(db, page.read, actor),
      issueQueries.getProject("STK"),
      docQueries.getDoc(stk, doc.id),
      docQueries.ancestors(doc.id),
      docQueries.linkedIssues(doc.id),
      docQueries.listVersions(doc.id),
      docQueries.listUsers(),
      issueQueries.listProjectKeys(),
      docQueries.supersedeOptions(stk, doc.id),
      docQueries.listTree(stk),
      createFileQueries(db, { read: page.read }).listAttachments("doc", doc.id),
      createCommentService(db, { runAtomic: transactionRunner(db), read: page.read }).listForDoc(
        doc.id,
      ),
      createHandbookQueries(db, { read: page.read }).docSync(stk, doc.id),
    ]);
    expect(page.trips()).toBe(1);
    expect(results.at(-1)).toMatchObject({ docId: doc.id, status: "not_in_handbook" });

    const settings = counted();
    const handbook = createHandbookQueries(db, { read: settings.read });
    const [, , , , , , , docsList, publications] = await Promise.all([
      ...appLayoutReads(db, settings.read, actor),
      createIssueQueries(db, { read: settings.read }).getProject("STK"),
      createSettingsQueries(db, { read: settings.read }).getSettings(stk),
      createImportQueries(db, { read: settings.read }).listImports(stk),
      handbook.listDocs(stk),
      handbook.recentPublications(stk),
    ]);
    expect(settings.trips()).toBe(1);
    expect(docsList.map((item) => item.docId)).toContain(doc.id);
    expect(publications.length).toBeGreaterThan(0);
  });
});
