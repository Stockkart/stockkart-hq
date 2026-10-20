import { describe, expect, it } from "vitest";

import {
  commit,
  createPayload,
  pullRequestPayload,
  pushPayload,
  repository,
} from "@/test/github-fixtures";

import {
  MAX_COMMITS_PER_PUSH,
  pullRequestPayload as prSchema,
  pushPayload as pushSchema,
  createPayload as createSchema,
} from "./payloads";
import { branchUrl, isOrgRepository, planCreate, planPullRequest, planPush } from "./plan";

const base = { deliveryId: "d-1", event: "test" };
const pr = (options: Parameters<typeof pullRequestPayload>[0]) =>
  planPullRequest(base, prSchema.parse(pullRequestPayload(options)));
const keysOf = (refs: { issue: { projectKey: string; number: number }; kind: string }[]) =>
  refs.map((ref) => `${ref.kind}:${ref.issue.projectKey}-${ref.issue.number}`);

describe("isOrgRepository (S-4)", () => {
  it("accepts Stockkart in any case and nothing else", () => {
    const parse = (name: string) => prSchema.parse(pullRequestPayload({ repo: name })).repository;
    expect(isOrgRepository(parse("Stockkart/inventory-api"))).toBe(true);
    expect(isOrgRepository(parse("stockkart/inventory-api"))).toBe(true);
    expect(isOrgRepository(parse("Evil/inventory-api"))).toBe(false);
    expect(isOrgRepository(parse("StockkartX/inventory-api"))).toBe(false);
    // Owner and full name must agree.
    expect(
      isOrgRepository({
        full_name: "Evil/x",
        owner: { login: "Stockkart" },
        html_url: "https://github.com/Evil/x",
        default_branch: "main",
      }),
    ).toBe(false);
  });
});

describe("planPush (GH-2)", () => {
  it("links the branch and each commit that mentions a key", () => {
    const plan = planPush(
      base,
      pushSchema.parse(
        pushPayload({
          ref: "refs/heads/stk-42-oom-ocr",
          commits: [
            commit("STK-42: cap the OCR pool\n\nAlso touches STK-7"),
            commit("chore: bump deps"),
          ],
        }),
      ),
    );
    expect(keysOf(plan.refs)).toEqual(["branch:STK-42", "commit:STK-42", "commit:STK-7"]);
    const [branch, firstCommit] = plan.refs;
    expect(branch).toMatchObject({
      refName: "stk-42-oom-ocr",
      url: "https://github.com/Stockkart/inventory-api/tree/stk-42-oom-ocr",
      state: null,
    });
    expect(firstCommit).toMatchObject({
      title: "STK-42: cap the OCR pool",
      authorLogin: "imf-ali",
    });
    expect(plan.pullRequest).toBeNull();
    expect(plan.closes).toBeNull();
  });

  it("links at most the first 100 commits", () => {
    const commits = Array.from({ length: 150 }, (_, index) => commit(`STK-${index + 1} work`));
    const plan = planPush(base, pushSchema.parse(pushPayload({ ref: "refs/heads/main", commits })));
    expect(plan.refs).toHaveLength(MAX_COMMITS_PER_PUSH);
    expect(plan.refs.at(-1)?.issue.number).toBe(100);
  });

  it("does not validate commits past the cap", () => {
    const commits = [
      ...Array.from({ length: 100 }, () => commit("STK-1")),
      { id: "not-a-sha", message: 1 },
    ];
    expect(pushSchema.safeParse(pushPayload({ commits })).success).toBe(true);
  });

  it("skips deleted branches and tags", () => {
    const deleted = planPush(
      base,
      pushSchema.parse(pushPayload({ ref: "refs/heads/stk-1-x", deleted: true })),
    );
    expect(deleted.refs).toEqual([]);
    const tag = planPush(base, pushSchema.parse(pushPayload({ ref: "refs/tags/stk-1" })));
    expect(tag.refs).toEqual([]);
  });

  it("rejects commit URLs outside github.com", () => {
    const bad = { ...commit("STK-1"), url: "https://evil.example/commit/1" };
    expect(pushSchema.safeParse(pushPayload({ commits: [bad] })).success).toBe(false);
  });

  it("encodes branch names in URLs, keeping the slashes", () => {
    expect(branchUrl(repository(), "feature/stk-1 #x")).toBe(
      "https://github.com/Stockkart/inventory-api/tree/feature/stk-1%20%23x",
    );
  });
});

describe("planCreate", () => {
  it("links a new branch", () => {
    const plan = planCreate(base, createSchema.parse(createPayload("stk-9-thing")));
    expect(keysOf(plan.refs)).toEqual(["branch:STK-9"]);
  });
});

describe("planPullRequest (GH-2, GH-3)", () => {
  it("links from the head branch, title and body, and the head branch itself", () => {
    const plan = pr({ head: "stk-1-x", title: "STK-2 thing", body: "See stk-3" });
    expect(keysOf(plan.refs)).toEqual(["pr:STK-1", "pr:STK-2", "pr:STK-3", "branch:STK-1"]);
    expect(plan.refs[0]).toMatchObject({ number: 118, state: "open", authorLogin: "imf-ali" });
  });

  it("does not link a fork's head branch", () => {
    const payload = pullRequestPayload({ head: "stk-1-x" });
    payload.pull_request.head.repo = { full_name: "someone/inventory-api" };
    const plan = planPullRequest(base, prSchema.parse(payload));
    expect(keysOf(plan.refs)).toEqual(["pr:STK-1"]);
  });

  it.each([
    [{ state: "open" as const }, "open"],
    [{ state: "open" as const, draft: true }, "draft"],
    [{ state: "closed" as const }, "closed"],
    [{ state: "closed" as const, merged: true }, "merged"],
  ])("maps %j to %s", (options, state) => {
    expect(pr({ ...options, title: "STK-1" }).pullRequest?.state).toBe(state);
  });

  it("opening a PR with a closing keyword never closes anything", () => {
    expect(pr({ action: "opened", body: "Fixes STK-1" }).closes).toBeNull();
  });

  it("closes on a merge into the default branch with closing keywords", () => {
    const plan = pr({
      action: "closed",
      state: "closed",
      merged: true,
      title: "OCR pool",
      body: "Fixes STK-1, STK-2",
      mergedBy: "rk",
    });
    expect(plan.closes).toEqual({
      issues: [
        { projectKey: "STK", number: 1 },
        { projectKey: "STK", number: 2 },
      ],
      pr: 118,
      mergedBy: "rk",
    });
  });

  it("links only when merged without a keyword, into another branch, or closed unmerged", () => {
    const merged = { action: "closed", state: "closed" as const, merged: true };
    expect(pr({ ...merged, body: "STK-1" }).closes).toBeNull();
    expect(pr({ ...merged, body: "Fixes STK-1", base: "release/1.x" }).closes).toBeNull();
    expect(pr({ ...merged, body: "Fixes STK-1", defaultBranch: "develop" }).closes).toBeNull();
    expect(
      pr({ action: "closed", state: "closed", merged: false, body: "Fixes STK-1" }).closes,
    ).toBeNull();
  });
});
