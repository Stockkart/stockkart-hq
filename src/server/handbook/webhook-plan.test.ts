import { afterEach, describe, expect, it, vi } from "vitest";

import { type DeliveryPlan } from "@/server/github/plan";
import { createGithubWebhookHandler } from "@/server/github/webhook";
import { type DeliveryResult } from "@/server/services/github";
import {
  pullRequestPayload,
  pushPayload,
  repository,
  sha,
  TEST_WEBHOOK_SECRET,
  webhookRequest,
} from "@/test/github-fixtures";

import {
  hqBranchesIn,
  MAX_HANDBOOK_PATHS,
  planHandbookPullRequest,
  planHandbookPush,
} from "./webhook-plan";

const HANDBOOK = "Stockkart/engineering-handbook";
const repo = () => {
  const value = repository(HANDBOOK);
  return { ...value, owner: { login: "Stockkart" } };
};

function handbookCommit(
  message: string,
  files: { added?: string[]; modified?: string[]; removed?: string[] },
) {
  const id = sha();
  return {
    id,
    message,
    url: `https://github.com/${HANDBOOK}/commit/${id}`,
    author: { username: "someone" },
    ...files,
  };
}

const push = (commits: unknown[], ref = "refs/heads/main") =>
  pushPayload({ repo: HANDBOOK, ref, commits });

describe("handbook push plan (DOC-14)", () => {
  it("collects .md paths; the last change wins; other files are ignored", () => {
    const plan = planHandbookPush(
      push([
        handbookCommit("edit", { modified: ["RUNBOOK.md", "scripts/x.sh"], added: ["NEW.md"] }),
        handbookCommit("drop", { removed: ["decisions/0002-old.md", "NEW.md"] }),
      ]),
      repo(),
    );
    expect(plan?.paths).toEqual([
      { path: "NEW.md", removed: true, branches: [] },
      { path: "RUNBOOK.md", removed: false, branches: [] },
      { path: "decisions/0002-old.md", removed: true, branches: [] },
    ]);
    expect(plan?.truncated).toBe(false);
  });

  it("ignores pushes to other branches and branch deletions", () => {
    const commits = [handbookCommit("x", { modified: ["RUNBOOK.md"] })];
    expect(planHandbookPush(push(commits, "refs/heads/feature"), repo())).toBeNull();
    expect(planHandbookPush({ ...push(commits), deleted: true }, repo())).toBeNull();
    expect(planHandbookPush(push([]), repo())).toBeNull();
  });

  it("marks HQ's own publication landing (every touching commit names an hq/ branch)", () => {
    const plan = planHandbookPush(
      push([
        handbookCommit(
          "docs: publish from Stockkart HQ\n\nHQ-Publication: hq/publish-20260501-abcd1234",
          {
            modified: ["RUNBOOK.md", "API_CONTRACT.md"],
          },
        ),
        handbookCommit("Merge pull request #7 from Stockkart/hq/publish-20260501-abcd1234", {
          modified: ["RUNBOOK.md"],
        }),
        handbookCommit("fix a typo", { modified: ["API_CONTRACT.md"] }),
      ]),
      repo(),
    );
    expect(plan?.paths).toEqual([
      { path: "RUNBOOK.md", removed: false, branches: ["hq/publish-20260501-abcd1234"] },
      // A person's commit touched it too: drift, whatever HQ's commit did.
      { path: "API_CONTRACT.md", removed: false, branches: [] },
    ]);
  });

  it("caps the paths at 500", () => {
    const many = Array.from({ length: MAX_HANDBOOK_PATHS + 10 }, (_, i) => `F${i}.md`);
    const plan = planHandbookPush(push([handbookCommit("bulk", { added: many })]), repo());
    expect(plan?.paths).toHaveLength(MAX_HANDBOOK_PATHS);
    expect(plan?.truncated).toBe(true);
  });

  it("counts only HQ's trailer and GitHub's merge subject, never a revert or a mention", () => {
    expect(hqBranchesIn("Merge pull request #7 from Stockkart/hq/publish-1\n\nPublish")).toEqual([
      "hq/publish-1",
    ]);
    expect(
      hqBranchesIn("Publish (#7)\n\n* docs: publish\n\n* HQ-Publication: hq/publish-2"),
    ).toEqual(["hq/publish-2"]);
    expect(hqBranchesIn("docs: x\n\nHQ-Publication: hq/publish-3\n")).toEqual(["hq/publish-3"]);
    expect(hqBranchesIn('Revert "Merge pull request #7 from Stockkart/hq/publish-1"')).toEqual([]);
    expect(
      hqBranchesIn("fixes the text from hq/publish-1, see HQ-Publication: hq/publish-1"),
    ).toEqual([]);
    expect(hqBranchesIn("HQ-Publication: hq/..\nHQ-Publication: hq/ok.lock")).toEqual([]);
  });
});

describe("handbook pull_request plan (DOC-14)", () => {
  const pr = (options: Parameters<typeof pullRequestPayload>[0]) =>
    pullRequestPayload({
      repo: HANDBOOK,
      number: 7,
      head: "hq/publish-20260501-abcd1234",
      ...options,
    });

  it("merged into the default branch → merged (clean only with HQ's one commit)", () => {
    const merged = pr({ action: "closed", state: "closed", merged: true });
    expect(
      planHandbookPullRequest({ ...merged, pull_request: { ...merged.pull_request, commits: 1 } }),
    ).toEqual({
      pullRequest: {
        number: 7,
        branch: "hq/publish-20260501-abcd1234",
        url: `https://github.com/${HANDBOOK}/pull/7`,
        outcome: "merged",
        mergedAt: "2026-01-02T03:04:05Z",
        cleanMerge: true,
      },
      paths: [],
      truncated: false,
    });
    const pushedTo = { ...merged, pull_request: { ...merged.pull_request, commits: 2 } };
    expect(planHandbookPullRequest(pushedTo)?.pullRequest?.cleanMerge).toBe(false);
    expect(planHandbookPullRequest(merged)?.pullRequest?.cleanMerge).toBe(false);
  });

  it("closed unmerged, or merged elsewhere → closed", () => {
    expect(
      planHandbookPullRequest(pr({ action: "closed", state: "closed" }))?.pullRequest?.outcome,
    ).toBe("closed");
    expect(
      planHandbookPullRequest(pr({ action: "closed", state: "closed", merged: true, base: "dev" }))
        ?.pullRequest?.outcome,
    ).toBe("closed");
  });

  it("ignores open events, non-hq branches and forks", () => {
    expect(planHandbookPullRequest(pr({ action: "opened" }))).toBeNull();
    expect(
      planHandbookPullRequest(pr({ action: "closed", state: "closed", head: "docs/x" })),
    ).toBeNull();
    const fork = pr({ action: "closed", state: "closed", merged: true });
    fork.pull_request.head.repo = { full_name: "someone/engineering-handbook" };
    expect(planHandbookPullRequest(fork)).toBeNull();
  });
});

describe("webhook routing of the handbook repo", () => {
  const applied: DeliveryResult = {
    duplicate: false,
    linked: 0,
    updated: 0,
    moved: 0,
    handbook: 1,
  };
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const apply = vi.fn<(plan: DeliveryPlan) => Promise<DeliveryResult>>();
    apply.mockResolvedValue(applied);
    const refresh = vi.fn();
    const handler = createGithubWebhookHandler({
      secret: () => TEST_WEBHOOK_SECRET,
      apply,
      refresh,
      handbookRepo: () => HANDBOOK,
      log: () => undefined,
    });
    return { handler, apply, refresh };
  }

  it("plans handbook changes after the signature check and never calls the GitHub API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { handler, apply, refresh } = setup();
    const body = push([handbookCommit("edit", { modified: ["RUNBOOK.md"] })]);

    const forged = await handler(webhookRequest("push", body, { secret: "wrong" }));
    expect(forged.status).toBe(401);
    expect(apply).not.toHaveBeenCalled();

    const response = await handler(webhookRequest("push", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, handbook: 1 });
    expect(apply.mock.calls[0]?.[0].handbook?.paths).toEqual([
      { path: "RUNBOOK.md", removed: false, branches: [] },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves other repositories' deliveries without a handbook plan", async () => {
    const { handler, apply } = setup();
    const other = pushPayload({
      repo: "Stockkart/inventory-api",
      commits: [
        {
          id: "c".repeat(40),
          message: "STK-1 docs",
          url: `https://github.com/Stockkart/inventory-api/commit/${"c".repeat(40)}`,
          modified: ["RUNBOOK.md"],
        },
      ],
    });
    await handler(webhookRequest("push", other));
    expect(apply.mock.calls[0]?.[0].handbook).toBeNull();
  });
});
