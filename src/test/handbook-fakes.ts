import { gitBlobSha } from "@/server/handbook/git-blob";
import { type HandbookGithub, HandbookGithubError } from "@/server/handbook/github-app";

/**
 * An in-memory handbook repo standing in for the GitHub App client (DOC-14 service tests).
 * No network: the client itself is tested with a fetch fake in github-app.test.ts.
 */
export const FAKE_HANDBOOK_REPO = "Stockkart/engineering-handbook";
export const MAIN_SHA = "1".repeat(40);

export type FakeStep = "createBranch" | "commitFiles" | "openPullRequest";

/** PR numbers are never reused on GitHub, so the counter outlives each fake repo. */
let nextPr = 100;

export function fakeHandbookRepo(options: { configured?: boolean } = {}) {
  /** Files on the default branch. */
  const files = new Map<string, string>();
  const calls: string[] = [];
  const branches: string[] = [];
  const commits: { branch: string; paths: string[]; message: string }[] = [];
  const prs: { number: number; head: string; base: string; title: string; body: string }[] = [];
  let failAt: { step: FakeStep; code: string } | null = null;
  let beforeGetFile: ((path: string) => Promise<void>) | null = null;

  function maybeFail(step: FakeStep) {
    if (failAt?.step === step) throw new HandbookGithubError(failAt.code, 422);
  }

  const github: HandbookGithub = {
    configured: () => options.configured ?? true,
    repo: FAKE_HANDBOOK_REPO,
    async getFile(path) {
      calls.push(`getFile ${path}`);
      await beforeGetFile?.(path);
      const content = files.get(path);
      return content === undefined ? null : { content, sha: gitBlobSha(content) };
    },
    async getDefaultBranch() {
      calls.push("getDefaultBranch");
      return { name: "main", sha: MAIN_SHA };
    },
    async listTree() {
      calls.push("listTree");
      return [...files].map(([path, content]) => ({ path, sha: gitBlobSha(content) }));
    },
    async createBranch(name) {
      calls.push(`createBranch ${name}`);
      maybeFail("createBranch");
      branches.push(name);
    },
    async commitFiles(branch, list, message) {
      calls.push(`commitFiles ${branch}`);
      maybeFail("commitFiles");
      commits.push({ branch, paths: list.map((file) => file.path), message });
      return {
        commitSha: "2".repeat(40),
        blobs: list.map((file) => ({ path: file.path, sha: gitBlobSha(file.content) })),
      };
    },
    async openPullRequest(head, base, title, body) {
      calls.push(`openPullRequest ${head}`);
      maybeFail("openPullRequest");
      nextPr += 1;
      prs.push({ number: nextPr, head, base, title, body });
      return { number: nextPr, url: `https://github.com/${FAKE_HANDBOOK_REPO}/pull/${nextPr}` };
    },
    async getPullRequest(number) {
      const pr = prs.find((item) => item.number === number);
      if (!pr) throw new HandbookGithubError("github_404", 404);
      return {
        number,
        url: `https://github.com/${FAKE_HANDBOOK_REPO}/pull/${number}`,
        state: "open" as const,
        headRef: pr.head,
      };
    },
  };

  return {
    github,
    files,
    calls,
    branches,
    commits,
    prs,
    failAt(step: FakeStep | null, code = "github_422") {
      failAt = step ? { step, code } : null;
    },
    onGetFile(hook: ((path: string) => Promise<void>) | null) {
      beforeGetFile = hook;
    },
  };
}
