import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_BRANCH_EXISTS_MESSAGE,
  GITHUB_BUSY_MESSAGE,
  GITHUB_KEY_MESSAGE,
  GITHUB_NO_COMMITS_MESSAGE,
  GITHUB_NOT_FOUND_MESSAGE,
  GITHUB_PR_EXISTS_MESSAGE,
  GITHUB_PR_REFUSED_MESSAGE,
  GITHUB_REF_MOVED_MESSAGE,
  githubAccessMessage,
} from "@/lib/handbook/github-errors";

import { gitBlobSha } from "./git-blob";
import {
  createAppJwt,
  createHandbookGithub,
  type HandbookAppConfig,
  handbookAppConfigFrom,
  HandbookGithubError,
  HandbookNotConfigured,
  JWT_LIFETIME_SECONDS,
  TOKEN_PERMISSIONS,
} from "./github-app";

/** A throwaway key made per test run: no real App key exists in tests. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CONFIG: HandbookAppConfig = {
  repo: "Stockkart/engineering-handbook",
  appId: "12345",
  installationId: "67890",
  privateKey: PEM,
};
const TOKEN = "ghs_testinstallationtoken000000000000000";
const NOW = Date.UTC(2026, 4, 1, 12, 0, 0);
const SHA = (n: number) => n.toString(16).padStart(40, "0");

function decodePart(part: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch fake: routes by "METHOD path"; records every call; never touches the network. */
function fakeGithub(
  routes: Record<string, (call: Call) => Response | Promise<Response>>,
  options: { now?: () => number } = {},
) {
  const calls: Call[] = [];
  const log = vi.fn();
  const sleep = vi.fn(async () => {});
  const fetchFake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const route = routes[`${call.method} ${url.pathname}`];
    if (!route) return new Response("{}", { status: 404 });
    return route(call);
  });
  const client = createHandbookGithub({
    config: CONFIG,
    fetch: fetchFake,
    now: options.now ?? (() => NOW),
    sleep,
    log,
  });
  return { client, calls, fetchFake, log, sleep };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const tokenRoute = (expiresAt = new Date(NOW + 60 * 60 * 1000).toISOString()) => ({
  "POST /app/installations/67890/access_tokens": () =>
    json({
      token: TOKEN,
      expires_at: expiresAt,
      repositories: [{ full_name: "Stockkart/engineering-handbook" }],
    }),
});

const REPO = "/repos/Stockkart/engineering-handbook";

describe("handbook GitHub App client (DOC-14)", () => {
  it("signs an RS256 app JWT with iat −60 s and exp ≤ 9 min, verifiable with the public key", () => {
    const now = Math.floor(NOW / 1000);
    const jwt = createAppJwt("12345", PEM, now);
    const [header, payload, signature] = jwt.split(".");
    expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = decodePart(payload);
    expect(claims).toEqual({ iat: now - 60, exp: now + JWT_LIFETIME_SECONDS, iss: "12345" });
    expect(Number(claims.exp) - now).toBeLessThanOrEqual(9 * 60);
    const ok = verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey(publicKey.export({ type: "spki", format: "pem" })),
      Buffer.from(signature ?? "", "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("refuses an unreadable key without echoing it", () => {
    const attempt = () =>
      createAppJwt("1", "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----", 0);
    expect(attempt).toThrow(HandbookGithubError);
    expect(attempt).toThrow(expect.objectContaining({ code: "bad_private_key" }));
    expect(attempt).toThrow(GITHUB_KEY_MESSAGE);
    expect(attempt).not.toThrow(/nope/);
  });

  it("asks for a token scoped to the handbook repo and three permissions, and caches it", async () => {
    let now = NOW;
    const { client, calls } = fakeGithub(
      {
        ...tokenRoute(new Date(NOW + 60 * 60 * 1000).toISOString()),
        [`GET ${REPO}/pulls/7`]: () =>
          json({
            number: 7,
            html_url: "https://github.com/Stockkart/engineering-handbook/pull/7",
            state: "open",
            merged: false,
            head: { ref: "hq/publish-x" },
          }),
      },
      { now: () => now },
    );
    await client.getPullRequest(7);
    await client.getPullRequest(7);
    const tokenCalls = calls.filter((call) => call.url.pathname.includes("access_tokens"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.body).toEqual({
      repositories: ["engineering-handbook"],
      permissions: TOKEN_PERMISSIONS,
    });
    expect(TOKEN_PERMISSIONS).toEqual({
      contents: "write",
      pull_requests: "write",
      metadata: "read",
    });
    expect(tokenCalls[0]?.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const apiCall = calls.find((call) => call.url.pathname.endsWith("/pulls/7"));
    expect(apiCall?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(apiCall?.headers.accept).toBe("application/vnd.github+json");
    expect(apiCall?.headers["x-github-api-version"]).toBe("2022-11-28");

    // 56 minutes later (5 min before expiry) the token is refreshed.
    now = NOW + 56 * 60 * 1000;
    await client.getPullRequest(7);
    expect(calls.filter((call) => call.url.pathname.includes("access_tokens"))).toHaveLength(2);
  });

  it("refuses a token that does not list exactly the handbook repo", async () => {
    const { client } = fakeGithub({
      "POST /app/installations/67890/access_tokens": () =>
        json({ token: TOKEN, expires_at: new Date(NOW + 3600_000).toISOString() }),
    });
    await expect(client.getPullRequest(1)).rejects.toMatchObject({ code: "github_bad_response" });
  });

  it("never retries creating a branch or a PR (not idempotent)", async () => {
    const { client, calls, sleep } = fakeGithub({
      ...tokenRoute(),
      [`POST ${REPO}/git/refs`]: () => json({}, 502),
      [`POST ${REPO}/pulls`]: () => json({}, 503),
    });
    await expect(client.createBranch("hq/x", SHA(1))).rejects.toMatchObject({
      code: "create_branch.502",
      kind: "create_branch",
      status: 502,
      message: GITHUB_BUSY_MESSAGE,
    });
    await expect(client.openPullRequest("hq/x", "main", "t", "b")).rejects.toMatchObject({
      code: "open_pull_request.503",
    });
    expect(
      calls.filter(
        (call) => call.method === "POST" && !call.url.pathname.includes("access_tokens"),
      ),
    ).toHaveLength(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("refuses a token GitHub scoped to another repo", async () => {
    const { client } = fakeGithub({
      "POST /app/installations/67890/access_tokens": () =>
        json({
          token: TOKEN,
          expires_at: new Date(NOW + 3600_000).toISOString(),
          repositories: [{ full_name: "Stockkart/inventory-api" }],
        }),
    });
    await expect(client.getPullRequest(1)).rejects.toMatchObject({ code: "token_scope" });
  });

  it("reads the default branch from the repo root (GET /repos/<owner>/<repo>)", async () => {
    const { client, calls } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}`]: () =>
        json({ full_name: "Stockkart/engineering-handbook", default_branch: "main" }),
      [`GET ${REPO}/git/ref/heads/main`]: () =>
        json({ ref: "refs/heads/main", object: { sha: SHA(7) } }),
    });
    await expect(client.getDefaultBranch()).resolves.toEqual({ name: "main", sha: SHA(7) });
    expect(calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      "POST /app/installations/67890/access_tokens",
      `GET ${REPO}`,
      `GET ${REPO}/git/ref/heads/main`,
    ]);
  });

  it("does not treat a repo whose name only starts with the handbook's as in scope", async () => {
    const { client, fetchFake } = fakeGithub(tokenRoute());
    // Same prefix, different repo: `/repos/Stockkart/engineering-handbook-old`.
    await expect(
      client.getFile("../../engineering-handbook-old/README.md", "main"),
    ).rejects.toThrow(HandbookGithubError);
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("can only address the handbook repo (hard check on every call)", async () => {
    const outside = createHandbookGithub({
      config: { ...CONFIG, repo: "SomeoneElse/engineering-handbook" },
      fetch: vi.fn(),
    });
    await expect(outside.getDefaultBranch()).rejects.toMatchObject({ code: "repo_scope" });

    // A renamed / redirected repo answering for another name is refused too.
    const { client } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}`]: () => json({ full_name: "Stockkart/other", default_branch: "main" }),
    });
    await expect(client.getDefaultBranch()).rejects.toMatchObject({ code: "repo_scope" });
  });

  it("validates every path and branch before any request", async () => {
    const { client, fetchFake } = fakeGithub(tokenRoute());
    for (const path of [
      "../secrets.md",
      ".github/workflows/x.md",
      "a/../b.md",
      "/abs.md",
      "x.txt",
    ]) {
      await expect(client.getFile(path, "main")).rejects.toMatchObject({ code: "bad_path" });
      await expect(
        client.commitFiles("hq/publish-1", [{ path, content: "x" }], "m"),
      ).rejects.toMatchObject({ code: "bad_path" });
    }
    await expect(
      client.commitFiles("main", [{ path: "A.md", content: "x" }], "m"),
    ).rejects.toMatchObject({ code: "bad_branch" });
    await expect(client.createBranch("feature/x", SHA(1))).rejects.toMatchObject({
      code: "bad_branch",
    });
    await expect(client.openPullRequest("main", "main", "t", "b")).rejects.toMatchObject({
      code: "bad_branch",
    });
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("reads a file (base64) or reports it missing", async () => {
    const content = "# Runbook\n\nÜber.\n";
    const { client, calls } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}/contents/RUNBOOK.md`]: () =>
        json({
          type: "file",
          sha: gitBlobSha(content),
          size: Buffer.byteLength(content),
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
        }),
    });
    expect(await client.getFile("RUNBOOK.md", "main")).toEqual({
      content,
      sha: gitBlobSha(content),
    });
    expect(calls.at(-1)?.url.searchParams.get("ref")).toBe("main");
    expect(await client.getFile("decisions/0001-x.md", SHA(2))).toBeNull();
  });

  it("commits many files in ONE commit: blobs → tree → commit → ref", async () => {
    const files = [
      { path: "RUNBOOK.md", content: "# Runbook\n" },
      { path: "decisions/0002-queue.md", content: "# 0002. Queue\n" },
    ];
    const { client, calls } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}/git/ref/heads/hq/publish-20260501-abcd1234`]: () =>
        json({ object: { sha: SHA(10) } }),
      [`GET ${REPO}/git/commits/${SHA(10)}`]: () => json({ sha: SHA(10), tree: { sha: SHA(11) } }),
      [`POST ${REPO}/git/blobs`]: (call) => {
        const body = call.body as { content: string };
        return json({ sha: gitBlobSha(body.content) }, 201);
      },
      [`POST ${REPO}/git/trees`]: () => json({ sha: SHA(12) }, 201),
      [`POST ${REPO}/git/commits`]: () => json({ sha: SHA(13), tree: { sha: SHA(12) } }, 201),
      [`PATCH ${REPO}/git/refs/heads/hq/publish-20260501-abcd1234`]: () =>
        json({ object: { sha: SHA(13) } }),
    });
    const result = await client.commitFiles("hq/publish-20260501-abcd1234", files, "docs: x");
    expect(
      calls
        .filter((call) => !call.url.pathname.includes("access_tokens"))
        .map((call) => `${call.method} ${call.url.pathname.replace(REPO, "")}`),
    ).toEqual([
      "GET /git/ref/heads/hq/publish-20260501-abcd1234",
      `GET /git/commits/${SHA(10)}`,
      "POST /git/blobs",
      "POST /git/blobs",
      "POST /git/trees",
      "POST /git/commits",
      "PATCH /git/refs/heads/hq/publish-20260501-abcd1234",
    ]);
    const tree = calls.find((call) => call.url.pathname.endsWith("/git/trees"))?.body;
    expect(tree).toEqual({
      base_tree: SHA(11),
      tree: files.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: gitBlobSha(file.content),
      })),
    });
    expect(
      calls.find((call) => call.method === "POST" && call.url.pathname.endsWith("/git/commits"))
        ?.body,
    ).toEqual({
      message: "docs: x",
      tree: SHA(12),
      parents: [SHA(10)],
    });
    expect(calls.at(-1)?.body).toEqual({ sha: SHA(13), force: false });
    expect(result).toEqual({
      commitSha: SHA(13),
      blobs: files.map((file) => ({ path: file.path, sha: gitBlobSha(file.content) })),
    });
  });

  it("retries once on 5xx and on 429 (honouring Retry-After), then gives up", async () => {
    let attempts = 0;
    const { client, sleep } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}/pulls/3`]: () => {
        attempts += 1;
        if (attempts === 1) return json({}, 429, { "retry-after": "2" });
        return json({
          number: 3,
          html_url: "https://github.com/Stockkart/engineering-handbook/pull/3",
          state: "closed",
          merged: true,
          head: { ref: "hq/x" },
        });
      },
      [`GET ${REPO}/pulls/4`]: () => json({}, 502),
    });
    expect(await client.getPullRequest(3)).toMatchObject({ number: 3, state: "merged" });
    expect(sleep).toHaveBeenCalledWith(2000);
    await expect(client.getPullRequest(4)).rejects.toMatchObject({
      code: "get_pull_request.502",
      message: GITHUB_BUSY_MESSAGE,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("logs only the request kind and status, never the token, JWT, key or content", async () => {
    const { client, log } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}/contents/A.md`]: () =>
        json({
          type: "file",
          sha: gitBlobSha("secret-ish body\n"),
          size: 16,
          encoding: "base64",
          content: Buffer.from("secret-ish body\n").toString("base64"),
        }),
    });
    await client.getFile("A.md", "main");
    const lines = JSON.stringify(log.mock.calls);
    expect(lines).not.toContain(TOKEN);
    expect(lines).not.toContain("secret-ish");
    expect(lines).not.toContain("PRIVATE KEY");
    for (const [line] of log.mock.calls)
      expect(Object.keys(line).sort()).toEqual(["kind", "status"]);
  });

  it("refuses a PR URL outside the handbook repo", async () => {
    const { client } = fakeGithub({
      ...tokenRoute(),
      [`POST ${REPO}/pulls`]: () =>
        json(
          {
            number: 9,
            html_url: "https://github.com/evil/repo/pull/9",
            state: "open",
            head: { ref: "hq/x" },
          },
          201,
        ),
    });
    await expect(client.openPullRequest("hq/x", "main", "t", "b")).rejects.toMatchObject({
      code: "bad_pr_url",
    });
  });

  it("is not configured unless every value is set (fail closed)", async () => {
    const env = { HANDBOOK_REPO: "Stockkart/engineering-handbook" };
    expect(handbookAppConfigFrom(env)).toBeNull();
    expect(
      handbookAppConfigFrom({ ...env, GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: PEM }),
    ).toBeNull();
    expect(
      handbookAppConfigFrom({
        ...env,
        GITHUB_APP_ID: "1",
        GITHUB_APP_INSTALLATION_ID: "2",
        GITHUB_APP_PRIVATE_KEY: PEM,
      }),
    ).not.toBeNull();
    const fetchFake = vi.fn();
    const client = createHandbookGithub({ config: null, fetch: fetchFake });
    expect(client.configured()).toBe(false);
    await expect(client.getDefaultBranch()).rejects.toBeInstanceOf(HandbookNotConfigured);
    await expect(client.createBranch("hq/x", SHA(1))).rejects.toBeInstanceOf(HandbookNotConfigured);
    await expect(
      client.commitFiles("hq/x", [{ path: "A.md", content: "x" }], "m"),
    ).rejects.toBeInstanceOf(HandbookNotConfigured);
    await expect(client.openPullRequest("hq/x", "main", "t", "b")).rejects.toBeInstanceOf(
      HandbookNotConfigured,
    );
    expect(fetchFake).not.toHaveBeenCalled();
  });
});

describe("gitBlobSha", () => {
  it("matches `git hash-object` for known fixtures", () => {
    // Values from `git hash-object` (git 2.x).
    expect(gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    // Byte length, not string length: multi-byte UTF-8.
    expect(gitBlobSha("# Ünïcode ✓\n")).toBe("bb4debb336f3f3a7f90c024b08c69081fd0a188c");
    expect(gitBlobSha(new TextEncoder().encode("hello\n"))).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });
});

/** Text GitHub might echo back (an input, a token-ish value): must never leave the client. */
const RAW = "RAW-GITHUB-ECHO ghs_leakedvalue0000000000 Bearer xyz";

/** A GitHub-style error body: `message` plus `errors[]`, both carrying the raw echo. */
const githubError = (status: number, message: string, errors: unknown[] = []) =>
  json({ message: `${message} ${RAW}`, errors, documentation_url: `https://docs/${RAW}` }, status);

describe("handbook GitHub errors are classified (DOC-14)", () => {
  async function failure(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HandbookGithubError);
    if (!(error instanceof HandbookGithubError)) throw new Error("expected a HandbookGithubError");
    return error;
  }

  const token422 = {
    "POST /app/installations/67890/access_tokens": () =>
      githubError(422, "There is at least one repository that does not exist or is not accessible"),
  };

  it("token 422 (repo not selected, permission missing or pending): installation_token.422", async () => {
    const { client, calls, log } = fakeGithub(token422);
    const error = await failure(client.getDefaultBranch());
    expect(error).toMatchObject({
      code: "installation_token.422",
      kind: "installation_token",
      status: 422,
    });
    expect(error.message).toBe(githubAccessMessage("Stockkart/engineering-handbook"));
    expect(calls).toHaveLength(1);
    expect(log.mock.calls).toEqual([[{ kind: "installation_token", status: 422 }]]);
  });

  it.each([
    [401, GITHUB_KEY_MESSAGE],
    [403, githubAccessMessage("Stockkart/engineering-handbook")],
    [404, githubAccessMessage("Stockkart/engineering-handbook")],
  ])("token %s", async (status, message) => {
    const { client } = fakeGithub({
      "POST /app/installations/67890/access_tokens": () => githubError(status, "Nope"),
    });
    const error = await failure(client.getDefaultBranch());
    expect(error.code).toBe(`installation_token.${status}`);
    expect(error.message).toBe(message);
  });

  it("repo or default branch missing: get_repo.404 / get_ref.404", async () => {
    const missingRepo = fakeGithub({ ...tokenRoute() });
    const repoError = await failure(missingRepo.client.getDefaultBranch());
    expect(repoError).toMatchObject({ code: "get_repo.404", message: GITHUB_NOT_FOUND_MESSAGE });

    const missingRef = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}`]: () =>
        json({ full_name: "Stockkart/engineering-handbook", default_branch: "main" }),
    });
    const refError = await failure(missingRef.client.getDefaultBranch());
    expect(refError).toMatchObject({ code: "get_ref.404", message: GITHUB_NOT_FOUND_MESSAGE });
  });

  it("create_branch 422 'Reference already exists'", async () => {
    const { client } = fakeGithub({
      ...tokenRoute(),
      [`POST ${REPO}/git/refs`]: () => githubError(422, "Reference already exists"),
    });
    const error = await failure(client.createBranch("hq/x", SHA(1)));
    expect(error).toMatchObject({
      code: "create_branch.422",
      hint: "ref_exists",
      message: GITHUB_BRANCH_EXISTS_MESSAGE,
    });
  });

  it.each([
    ["No commits between main and hq/x", "no_commits", GITHUB_NO_COMMITS_MESSAGE],
    ["A pull request already exists for Stockkart:hq/x.", "pr_exists", GITHUB_PR_EXISTS_MESSAGE],
    ["Something else", "other", GITHUB_PR_REFUSED_MESSAGE],
  ])("open_pull_request 422: %s", async (text, hint, message) => {
    const { client } = fakeGithub({
      ...tokenRoute(),
      // GitHub puts the reason in errors[].message, under "Validation Failed".
      [`POST ${REPO}/pulls`]: () =>
        githubError(422, "Validation Failed", [
          { resource: "PullRequest", code: "custom", message: `${text} ${RAW}` },
        ]),
    });
    const error = await failure(client.openPullRequest("hq/x", "main", "t", "b"));
    expect(error).toMatchObject({ code: "open_pull_request.422", hint, message });
  });

  it("update_ref 422 (the branch moved): the handbook changed while publishing", async () => {
    const { client } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}/git/ref/heads/hq/x`]: () => json({ object: { sha: SHA(10) } }),
      [`GET ${REPO}/git/commits/${SHA(10)}`]: () => json({ sha: SHA(10), tree: { sha: SHA(11) } }),
      [`POST ${REPO}/git/blobs`]: (call) =>
        json({ sha: gitBlobSha((call.body as { content: string }).content) }, 201),
      [`POST ${REPO}/git/trees`]: () => json({ sha: SHA(12) }, 201),
      [`POST ${REPO}/git/commits`]: () => json({ sha: SHA(13), tree: { sha: SHA(12) } }, 201),
      [`PATCH ${REPO}/git/refs/heads/hq/x`]: () => githubError(422, "Update is not a fast forward"),
    });
    const error = await failure(client.commitFiles("hq/x", [{ path: "A.md", content: "x" }], "m"));
    expect(error).toMatchObject({ code: "update_ref.422", message: GITHUB_REF_MOVED_MESSAGE });
  });

  it("429 / 5xx after the retry, or a 403 rate limit: GitHub is busy", async () => {
    const { client, sleep } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}/pulls/5`]: () => json({}, 429),
      [`GET ${REPO}/pulls/6`]: () => githubError(403, "API rate limit exceeded for installation"),
    });
    expect(await failure(client.getPullRequest(5))).toMatchObject({
      code: "get_pull_request.429",
      message: GITHUB_BUSY_MESSAGE,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(await failure(client.getPullRequest(6))).toMatchObject({
      code: "get_pull_request.403",
      hint: "rate_limited",
      message: GITHUB_BUSY_MESSAGE,
    });
  });

  it("anything else: GitHub refused the <kind> request (HTTP <status>)", async () => {
    const { client } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}/contents/A.md`]: () => githubError(403, "Resource not accessible"),
      [`GET ${REPO}/git/trees/${SHA(3)}`]: () =>
        new Response("<html>not json</html>", { status: 409 }),
    });
    expect(await failure(client.getFile("A.md", "main"))).toMatchObject({
      code: "get_file.403",
      message: "GitHub refused the get_file request (HTTP 403).",
    });
    expect(await failure(client.listTree(SHA(3)))).toMatchObject({
      code: "list_tree.409",
      hint: null,
      message: "GitHub refused the list_tree request (HTTP 409).",
    });
  });

  it("a timeout carries the kind: <kind>.timeout", async () => {
    const timeout = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    const client = createHandbookGithub({
      config: CONFIG,
      fetch: vi.fn(async () => {
        throw timeout;
      }),
      log: vi.fn(),
    });
    expect(await failure(client.getDefaultBranch())).toMatchObject({
      code: "installation_token.timeout",
    });
  });

  it("never puts GitHub's raw message in the thrown message, the logs or the code", async () => {
    const cases: [
      Record<string, () => Response>,
      (c: ReturnType<typeof fakeGithub>["client"]) => Promise<unknown>,
    ][] = [
      [token422, (c) => c.getDefaultBranch()],
      [
        {
          ...tokenRoute(),
          [`POST ${REPO}/git/refs`]: () => githubError(422, "Reference already exists"),
        },
        (c) => c.createBranch("hq/x", SHA(1)),
      ],
      [
        {
          ...tokenRoute(),
          [`POST ${REPO}/pulls`]: () =>
            githubError(422, "Validation Failed", [
              { code: "custom", message: `No commits between ${RAW}` },
              RAW,
            ]),
        },
        (c) => c.openPullRequest("hq/x", "main", "t", "b"),
      ],
      [
        { ...tokenRoute(), [`GET ${REPO}`]: () => githubError(500, "Server Error") },
        (c) => c.getDefaultBranch(),
      ],
    ];
    for (const [routes, run] of cases) {
      const { client, log } = fakeGithub(routes);
      const error = await failure(run(client));
      const seen = JSON.stringify([
        error.message,
        error.code,
        error.name,
        error.stack,
        log.mock.calls,
      ]);
      expect(seen).not.toContain("RAW-GITHUB-ECHO");
      expect(seen).not.toContain("ghs_leakedvalue");
      expect(error.code).toMatch(/^[a-z0-9_.-]{1,64}$/);
      expect(error.code).toMatch(/^[a-z_]+\.[0-9]{3}$/);
      for (const [line] of log.mock.calls)
        expect(Object.keys(line).sort()).toEqual(["kind", "status"]);
    }
  });
});

describe("Test connection (DOC-14)", () => {
  it("gets a fresh token and reads the default branch; nothing is written", async () => {
    const { client, calls } = fakeGithub({
      ...tokenRoute(),
      [`GET ${REPO}`]: () =>
        json({ full_name: "Stockkart/engineering-handbook", default_branch: "main" }),
      [`GET ${REPO}/git/ref/heads/main`]: () => json({ object: { sha: SHA(7) } }),
    });
    await client.getDefaultBranch();
    await expect(client.testConnection()).resolves.toEqual({
      repo: "Stockkart/engineering-handbook",
      defaultBranch: "main",
    });
    // The second token request: the test does not trust the cached token.
    expect(calls.filter((call) => call.url.pathname.includes("access_tokens"))).toHaveLength(2);
    const writes = calls.filter(
      (call) => call.method !== "GET" && !call.url.pathname.includes("access_tokens"),
    );
    expect(writes).toEqual([]);
  });

  it("reports the token 422 as the access problem", async () => {
    const { client, calls } = fakeGithub({
      "POST /app/installations/67890/access_tokens": () => githubError(422, "Not accessible"),
    });
    await expect(client.testConnection()).rejects.toMatchObject({
      code: "installation_token.422",
      message: githubAccessMessage("Stockkart/engineering-handbook"),
    });
    expect(calls).toHaveLength(1);
  });

  it("is not configured without the App values (no request)", async () => {
    const fetchFake = vi.fn();
    const client = createHandbookGithub({ config: null, fetch: fetchFake });
    await expect(client.testConnection()).rejects.toBeInstanceOf(HandbookNotConfigured);
    expect(fetchFake).not.toHaveBeenCalled();
  });
});
