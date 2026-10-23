import { createPrivateKey, sign } from "node:crypto";

import { z } from "zod";

import { isHandbookPath } from "@/lib/docs/handbook-path";
import {
  GIT_SHA_PATTERN,
  HANDBOOK_BRANCH_REGEX_SOURCE,
  HANDBOOK_NOT_CONFIGURED_MESSAGE,
  isHandbookRepo,
} from "@/lib/handbook/constants";
import {
  describeHandbookError,
  type GithubFailureHint,
  type HandbookGithubRequestKind,
  handbookGithubErrorCode,
} from "@/lib/handbook/github-errors";

import { gitBlobSha } from "./git-blob";

/**
 * DOC-14 GitHub App client for the handbook repo, on `fetch` only (no SDK).
 *
 * Security model:
 *   - The App authenticates with a short JWT (RS256 over the App's private key, `iat` 60 s in
 *     the past for clock skew, `exp` 9 min ahead; GitHub allows 10), exchanged for an
 *     installation token that is scoped to the handbook repo ONLY and to
 *     `contents: write, pull_requests: write, metadata: read`. The token is cached in memory
 *     until 5 minutes before it expires; it never leaves this module.
 *   - Every request URL is built here and re-checked before sending: either the token
 *     endpoint of the configured installation, or a path under `/repos/<HANDBOOK_REPO>/`.
 *     Nothing else is reachable, whatever a caller passes.
 *   - Every file path read or written must pass `isHandbookPath` (Markdown under the repo,
 *     no `..`, no dot-directories), and HQ only writes `hq/…` branches.
 *   - Logs carry the request kind and status code only: never the token, the JWT, the key or
 *     any file content. Errors carry a short code (`<kind>.<status>`, e.g.
 *     `installation_token.422`), never a response body; GitHub's JSON error body is only
 *     read to pick a known case (`failureHint`) and then dropped.
 *   - 10 s timeout per request; one retry on 5xx / 429 (honouring `Retry-After`, capped),
 *     except for creating a branch or a PR (not idempotent).
 *     Redirects are refused, so a renamed repo cannot take the token to another URL.
 */

export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const REQUEST_TIMEOUT_MS = 10_000;
/** Longest `Retry-After` honoured inside a server action. */
export const MAX_RETRY_AFTER_MS = 10_000;
/** The token is refreshed this long before GitHub says it expires. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** JWT lifetime (GitHub refuses more than 10 minutes). */
export const JWT_LIFETIME_SECONDS = 9 * 60;
/** Larger files are not handled (the handbook's are a few KB). */
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_FILES_PER_COMMIT = 50;

/** Exactly what the installation token may do. */
export const TOKEN_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  metadata: "read",
} as const;

export interface HandbookAppConfig {
  /** `Owner/repo` (validated by env.ts: Stockkart org). */
  repo: string;
  appId: string;
  installationId: string;
  /** PEM. */
  privateKey: string;
}

/** The App config, or null unless every value is set (fail closed on a partial setup). */
export function handbookAppConfigFrom(source: {
  HANDBOOK_REPO: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}): HandbookAppConfig | null {
  const { HANDBOOK_REPO, GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY } =
    source;
  if (!GITHUB_APP_ID || !GITHUB_APP_INSTALLATION_ID || !GITHUB_APP_PRIVATE_KEY) return null;
  if (!isHandbookRepo(HANDBOOK_REPO)) return null;
  return {
    repo: HANDBOOK_REPO,
    appId: GITHUB_APP_ID,
    installationId: GITHUB_APP_INSTALLATION_ID,
    privateKey: GITHUB_APP_PRIVATE_KEY,
  };
}

export class HandbookNotConfigured extends Error {
  constructor() {
    super(HANDBOOK_NOT_CONFIGURED_MESSAGE);
    this.name = "HandbookNotConfigured";
  }
}

/**
 * A failed GitHub call. `code` is short and safe to store (`handbook_publications.error_code`):
 * `<kind>.<status>` for a request GitHub refused or never answered, else a check's own code
 * (`bad_path` …). The message is the classified reason (`describeHandbookError`), never a
 * response body.
 */
export class HandbookGithubError extends Error {
  readonly kind: HandbookGithubRequestKind | null;
  readonly hint: GithubFailureHint | null;

  constructor(
    readonly code: string,
    readonly status: number | null = null,
    options: {
      kind?: HandbookGithubRequestKind;
      hint?: GithubFailureHint | null;
      repo?: string;
    } = {},
  ) {
    super(describeHandbookError(code, { hint: options.hint, repo: options.repo }));
    this.name = "HandbookGithubError";
    this.kind = options.kind ?? null;
    this.hint = options.hint ?? null;
  }
}

/** The error for a request GitHub answered with a non-OK status. */
function httpError(
  kind: HandbookGithubRequestKind,
  status: number,
  repo: string,
  hint: GithubFailureHint | null = null,
): HandbookGithubError {
  return new HandbookGithubError(handbookGithubErrorCode(kind, status), status, {
    kind,
    hint,
    repo,
  });
}

/** Longest error body read (only to classify it; never kept). */
const MAX_ERROR_BODY_CHARS = 64 * 1024;
const errorBody = z.object({
  message: z.string().optional(),
  errors: z
    .array(
      z.union([
        z.string(),
        z.object({ code: z.string().optional(), message: z.string().optional() }),
      ]),
    )
    .optional(),
});

/**
 * Reduces GitHub's JSON error body to a known case. The body (which may echo what HQ sent)
 * is dropped here: only the hint leaves this function, never the text.
 */
async function failureHint(
  kind: HandbookGithubRequestKind,
  response: Response,
): Promise<GithubFailureHint | null> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.length > MAX_ERROR_BODY_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = errorBody.safeParse(raw);
  if (!parsed.success) return null;
  const errors = parsed.data.errors ?? [];
  const messages = [
    parsed.data.message ?? "",
    ...errors.map((item) => (typeof item === "string" ? item : (item.message ?? ""))),
  ];
  const codes = errors.flatMap((item) => (typeof item === "string" ? [] : [item.code ?? ""]));
  const says = (pattern: RegExp) => messages.some((message) => pattern.test(message));
  if (says(/rate limit/i)) return "rate_limited";
  if (
    kind === "create_branch" &&
    (says(/reference already exists/i) || codes.includes("already_exists"))
  ) {
    return "ref_exists";
  }
  if (kind === "open_pull_request") {
    if (says(/no commits between/i)) return "no_commits";
    if (says(/a pull request already exists/i)) return "pr_exists";
  }
  return "other";
}

const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The App's JWT (RS256). `nowSeconds` is injectable for tests. */
export function createAppJwt(appId: string, privateKey: string, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + JWT_LIFETIME_SECONDS, iss: appId }),
  );
  const signingInput = `${header}.${payload}`;
  let key;
  try {
    key = createPrivateKey(privateKey);
  } catch {
    // Never echo the key or the parser's message (which can quote it).
    throw new HandbookGithubError("bad_private_key");
  }
  const signature = sign("sha256", Buffer.from(signingInput), key);
  return `${signingInput}.${base64url(signature)}`;
}

const BRANCH_PATTERN = new RegExp(HANDBOOK_BRANCH_REGEX_SOURCE);
/** A branch HQ may write: `hq/<one segment>` (also CHECKed on publications). */
export function isHqBranch(name: string): boolean {
  return BRANCH_PATTERN.test(name) && !name.includes("..") && !name.endsWith(".lock");
}
/** A branch HQ may read or target (the default branch): plain git ref characters. */
const SAFE_BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._/-]{1,200}$/;

const sha = z.string().regex(GIT_SHA_PATTERN);
const tokenResponse = z.object({
  token: z.string().min(10).max(1000),
  expires_at: z.iso.datetime({ offset: true }),
  repositories: z.array(z.object({ full_name: z.string() })),
});
const repoResponse = z.object({ full_name: z.string(), default_branch: z.string() });
const refResponse = z.object({ object: z.object({ sha }) });
const commitResponse = z.object({ sha, tree: z.object({ sha }) });
const contentResponse = z.object({
  type: z.string(),
  sha,
  size: z.number().int().nonnegative(),
  encoding: z.string().optional(),
  content: z.string().optional(),
});
const blobResponse = z.object({
  sha,
  size: z.number().int().nonnegative().optional(),
  encoding: z.string().optional(),
  content: z.string().optional(),
});
const treeResponse = z.object({
  sha,
  truncated: z.boolean().optional(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })),
});
const createdTree = z.object({ sha });
const pullResponse = z.object({
  number: z.number().int().positive(),
  html_url: z.string(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean().nullish(),
  head: z.object({ ref: z.string() }),
});

export interface RepoFile {
  content: string;
  sha: string;
}

export interface CommitFile {
  path: string;
  content: string;
}

export interface CommittedFiles {
  commitSha: string;
  /** Each path's git blob, as GitHub stored it (checked against `gitBlobSha`). */
  blobs: { path: string; sha: string }[];
}

export interface HandbookGithubDeps {
  config: HandbookAppConfig | null;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: { kind: string; status: number | string }) => void;
}

const defaultLog = (line: { kind: string; status: number | string }) =>
  process.stdout.write(`[handbook-github] ${JSON.stringify(line)}\n`);

/** Seconds (or an HTTP date) from `Retry-After`, in ms, capped; 1 s when absent. */
function retryAfterMs(response: Response, now: number): number {
  const value = response.headers.get("retry-after");
  if (!value) return 1000;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Math.min(Math.max(Number.isFinite(ms) ? ms : 1000, 0), MAX_RETRY_AFTER_MS);
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HandbookGithubError("not_utf8");
  }
}

export function createHandbookGithub(deps: HandbookGithubDeps) {
  const config = deps.config;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? defaultLog;
  let cached: { token: string; refreshAt: number } | null = null;

  function requireConfig(): HandbookAppConfig {
    if (!config) throw new HandbookNotConfigured();
    // Hard check on every call: the client only ever addresses the handbook repo.
    if (!isHandbookRepo(config.repo)) throw new HandbookGithubError("repo_scope");
    return config;
  }

  /** `/repos/<owner>/<repo>` of the configured repo, as the URL path GitHub expects. */
  function repoPrefix(cfg: HandbookAppConfig): string {
    const [owner = "", name = ""] = cfg.repo.split("/");
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }

  /**
   * The one place a URL is made. `path` is checked after URL normalisation, so `..` or an
   * encoded slash cannot step outside the allowed prefixes.
   */
  function apiUrl(cfg: HandbookAppConfig, path: string, query?: Record<string, string>): URL {
    const url = new URL(path, GITHUB_API);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const tokenPath = `/app/installations/${encodeURIComponent(cfg.installationId)}/access_tokens`;
    // The repo itself (`GET /repos/<owner>/<repo>`, for the default branch) and paths under it.
    const repoRoot = repoPrefix(cfg).toLowerCase();
    const pathname = url.pathname.toLowerCase();
    const allowed =
      url.origin === GITHUB_API &&
      !/%2f|%2e|%5c/i.test(url.pathname) &&
      (url.pathname === tokenPath || pathname === repoRoot || pathname.startsWith(`${repoRoot}/`));
    if (!allowed) throw new HandbookGithubError("repo_scope");
    return url;
  }

  async function send(
    kind: HandbookGithubRequestKind,
    url: URL,
    init: { method: string; authorization: string; body?: unknown; retry?: boolean },
  ): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: init.method,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            "User-Agent": "stockkart-hq",
            Authorization: init.authorization,
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const timeout = error instanceof Error && error.name === "TimeoutError";
        log({ kind, status: timeout ? "timeout" : "network" });
        throw new HandbookGithubError(
          handbookGithubErrorCode(kind, timeout ? "timeout" : "network"),
          null,
          { kind },
        );
      }
      log({ kind, status: response.status });
      const retryable = response.status >= 500 || response.status === 429;
      // Creating a branch or a PR is not idempotent: a retry after a 5xx that did create it
      // would fail (422) and record a publication as failed while it exists on GitHub.
      if (retryable && attempt === 1 && init.retry !== false) {
        await sleep(retryAfterMs(response, now()));
        continue;
      }
      return response;
    }
  }

  async function installationToken(cfg: HandbookAppConfig): Promise<string> {
    if (cached && now() < cached.refreshAt) return cached.token;
    const jwt = createAppJwt(cfg.appId, cfg.privateKey, Math.floor(now() / 1000));
    const [, name = ""] = cfg.repo.split("/");
    const url = apiUrl(
      cfg,
      `/app/installations/${encodeURIComponent(cfg.installationId)}/access_tokens`,
    );
    const response = await send("installation_token", url, {
      method: "POST",
      authorization: `Bearer ${jwt}`,
      // Scoped down to the handbook repo and the three permissions publish/pull need, even
      // if the installation itself was granted more.
      body: { repositories: [name], permissions: TOKEN_PERMISSIONS },
    });
    if (!response.ok) {
      throw httpError(
        "installation_token",
        response.status,
        cfg.repo,
        await failureHint("installation_token", response),
      );
    }
    const parsed = tokenResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new HandbookGithubError("github_bad_response");
    // The token must be for exactly the handbook repo (GitHub lists what it covers).
    const repos = parsed.data.repositories;
    if (repos.length !== 1 || repos[0]?.full_name.toLowerCase() !== cfg.repo.toLowerCase()) {
      throw new HandbookGithubError("token_scope", null, {
        kind: "installation_token",
        repo: cfg.repo,
      });
    }
    cached = {
      token: parsed.data.token,
      refreshAt: Date.parse(parsed.data.expires_at) - TOKEN_REFRESH_MARGIN_MS,
    };
    return parsed.data.token;
  }

  /** A request under `/repos/<repo>`; returns the parsed body, or null on an allowed 404. */
  async function repoCall<S extends z.ZodType>(
    kind: HandbookGithubRequestKind,
    method: string,
    suffix: string,
    schema: S,
    options: {
      body?: unknown;
      query?: Record<string, string>;
      allow404?: boolean;
      retry?: boolean;
    } = {},
  ): Promise<z.output<S> | null> {
    const cfg = requireConfig();
    const url = apiUrl(cfg, `${repoPrefix(cfg)}${suffix}`, options.query);
    const token = await installationToken(cfg);
    const response = await send(kind, url, {
      method,
      authorization: `Bearer ${token}`,
      body: options.body,
      retry: options.retry,
    });
    if (response.status === 404 && options.allow404) return null;
    if (response.status === 401) cached = null;
    if (!response.ok) {
      throw httpError(kind, response.status, cfg.repo, await failureHint(kind, response));
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new HandbookGithubError("github_bad_response");
    return parsed.data;
  }

  /** The value of a call made with `allow404`, where a 404 is a failure after all. */
  async function must<T>(kind: HandbookGithubRequestKind, value: Promise<T | null>): Promise<T> {
    const result = await value;
    if (result === null) throw httpError(kind, 404, config?.repo ?? "");
    return result;
  }

  function checkBranch(name: string, writable: boolean) {
    if (writable ? !isHqBranch(name) : !SAFE_BRANCH.test(name)) {
      throw new HandbookGithubError("bad_branch");
    }
  }

  function checkSha(value: string) {
    if (!GIT_SHA_PATTERN.test(value)) throw new HandbookGithubError("bad_sha");
  }

  function encodePath(path: string): string {
    if (!isHandbookPath(path)) throw new HandbookGithubError("bad_path");
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async function readBlob(blobSha: string): Promise<string> {
    const blob = await must(
      "get_blob",
      repoCall("get_blob", "GET", `/git/blobs/${blobSha}`, blobResponse, { allow404: true }),
    );
    if ((blob.size ?? 0) > MAX_FILE_BYTES) throw new HandbookGithubError("file_too_large");
    if (blob.encoding !== "base64" || blob.content === undefined) {
      throw new HandbookGithubError("github_bad_response");
    }
    return decodeUtf8(Buffer.from(blob.content, "base64"));
  }

  async function refSha(branch: string): Promise<string> {
    const ref = await must(
      "get_ref",
      repoCall("get_ref", "GET", `/git/ref/heads/${branch}`, refResponse, { allow404: true }),
    );
    return ref.object.sha;
  }

  /** The default branch and its head commit. */
  async function defaultBranch(): Promise<{ name: string; sha: string }> {
    const cfg = requireConfig();
    const repo = await must(
      "get_repo",
      repoCall("get_repo", "GET", "", repoResponse, { allow404: true }),
    );
    // A renamed or transferred repo answers for another name: refuse to follow it.
    if (repo.full_name.toLowerCase() !== cfg.repo.toLowerCase()) {
      throw new HandbookGithubError("repo_scope", null, { kind: "get_repo", repo: cfg.repo });
    }
    checkBranch(repo.default_branch, false);
    return { name: repo.default_branch, sha: await refSha(repo.default_branch) };
  }

  return {
    /** Whether every App value is set; the page shows this, no request is made. */
    configured: () => config !== null,
    repo: config?.repo ?? null,

    /**
     * Settings → Handbook "Test connection": a fresh installation token (not the cached one,
     * so the App's access is checked as it is now), then the repo and its default branch.
     * Reads only; nothing is written to GitHub.
     */
    async testConnection(): Promise<{ repo: string; defaultBranch: string }> {
      const cfg = requireConfig();
      cached = null;
      await installationToken(cfg);
      const branch = await defaultBranch();
      return { repo: cfg.repo, defaultBranch: branch.name };
    },

    /** A Markdown file on `ref` (branch or commit sha), or null when it does not exist. */
    async getFile(path: string, ref: string): Promise<RepoFile | null> {
      const encoded = encodePath(path);
      if (!GIT_SHA_PATTERN.test(ref)) checkBranch(ref, false);
      const file = await repoCall("get_file", "GET", `/contents/${encoded}`, contentResponse, {
        query: { ref },
        allow404: true,
      });
      if (!file) return null;
      if (file.type !== "file") return null;
      if (file.size > MAX_FILE_BYTES) throw new HandbookGithubError("file_too_large");
      // Files over 1 MB come without content; anything smaller is inline base64.
      const content =
        file.encoding === "base64" && file.content !== undefined
          ? decodeUtf8(Buffer.from(file.content, "base64"))
          : await readBlob(file.sha);
      return { content, sha: file.sha };
    },

    /** The default branch and its head commit. */
    getDefaultBranch: defaultBranch,

    /** Every handbook Markdown file (`isHandbookPath`) in the tree of a commit. */
    async listTree(commitSha: string): Promise<{ path: string; sha: string }[]> {
      checkSha(commitSha);
      const tree = await must(
        "list_tree",
        repoCall("list_tree", "GET", `/git/trees/${commitSha}`, treeResponse, {
          query: { recursive: "1" },
          allow404: true,
        }),
      );
      if (tree.truncated) throw new HandbookGithubError("tree_truncated");
      return tree.tree.flatMap((entry) =>
        entry.type === "blob" && isHandbookPath(entry.path) && GIT_SHA_PATTERN.test(entry.sha)
          ? [{ path: entry.path, sha: entry.sha }]
          : [],
      );
    },

    /** A new `hq/…` branch at `fromSha`. */
    async createBranch(name: string, fromSha: string): Promise<void> {
      checkBranch(name, true);
      checkSha(fromSha);
      await repoCall("create_branch", "POST", "/git/refs", refResponse, {
        body: { ref: `refs/heads/${name}`, sha: fromSha },
        retry: false,
      });
    },

    /**
     * One commit with every file on an `hq/…` branch (Git Data API): blobs → tree (on the
     * branch head's tree) → commit → fast-forward the ref (never forced).
     */
    async commitFiles(
      branch: string,
      files: readonly CommitFile[],
      message: string,
    ): Promise<CommittedFiles> {
      checkBranch(branch, true);
      if (files.length === 0 || files.length > MAX_FILES_PER_COMMIT) {
        throw new HandbookGithubError("bad_files");
      }
      const seen = new Set<string>();
      for (const file of files) {
        if (!isHandbookPath(file.path)) throw new HandbookGithubError("bad_path");
        if (seen.has(file.path.toLowerCase())) throw new HandbookGithubError("bad_files");
        seen.add(file.path.toLowerCase());
        if (Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) {
          throw new HandbookGithubError("file_too_large");
        }
      }
      const headSha = await refSha(branch);
      const head = await must(
        "get_commit",
        repoCall("get_commit", "GET", `/git/commits/${headSha}`, commitResponse, {
          allow404: true,
        }),
      );
      const blobs: { path: string; sha: string }[] = [];
      for (const file of files) {
        const blob = await must(
          "create_blob",
          repoCall("create_blob", "POST", "/git/blobs", blobResponse, {
            body: { content: file.content, encoding: "utf-8" },
          }),
        );
        // What publish records must be what GitHub stored.
        if (blob.sha !== gitBlobSha(file.content)) throw new HandbookGithubError("blob_mismatch");
        blobs.push({ path: file.path, sha: blob.sha });
      }
      const tree = await must(
        "create_tree",
        repoCall("create_tree", "POST", "/git/trees", createdTree, {
          body: {
            base_tree: head.tree.sha,
            tree: blobs.map((blob) => ({
              path: blob.path,
              mode: "100644",
              type: "blob",
              sha: blob.sha,
            })),
          },
        }),
      );
      const commit = await must(
        "create_commit",
        repoCall("create_commit", "POST", "/git/commits", commitResponse, {
          body: { message, tree: tree.sha, parents: [headSha] },
        }),
      );
      await repoCall("update_ref", "PATCH", `/git/refs/heads/${branch}`, refResponse, {
        body: { sha: commit.sha, force: false },
      });
      return { commitSha: commit.sha, blobs };
    },

    async openPullRequest(
      head: string,
      base: string,
      title: string,
      body: string,
    ): Promise<{ number: number; url: string }> {
      const cfg = requireConfig();
      checkBranch(head, true);
      checkBranch(base, false);
      const pr = await must(
        "open_pull_request",
        repoCall("open_pull_request", "POST", "/pulls", pullResponse, {
          body: { title, head, base, body, maintainer_can_modify: false, draft: false },
          retry: false,
        }),
      );
      return { number: pr.number, url: prUrl(cfg, pr.number, pr.html_url) };
    },

    async getPullRequest(number: number) {
      const cfg = requireConfig();
      if (!Number.isInteger(number) || number < 1) throw new HandbookGithubError("bad_number");
      const pr = await must(
        "get_pull_request",
        repoCall("get_pull_request", "GET", `/pulls/${number}`, pullResponse, { allow404: true }),
      );
      return {
        number: pr.number,
        url: prUrl(cfg, pr.number, pr.html_url),
        state: pr.merged ? ("merged" as const) : pr.state,
        headRef: pr.head.ref,
      };
    },
  };
}

/** The PR's page, which must be in the handbook repo (it is stored and shown as a link). */
function prUrl(cfg: HandbookAppConfig, number: number, url: string): string {
  const expected = `https://github.com/${cfg.repo}/pull/${number}`;
  if (url.toLowerCase() !== expected.toLowerCase()) throw new HandbookGithubError("bad_pr_url");
  return url;
}

export type HandbookGithub = ReturnType<typeof createHandbookGithub>;
