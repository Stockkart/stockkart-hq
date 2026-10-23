import { describe, expect, it } from "vitest";

import { HANDBOOK_ERROR_CODE_REGEX_SOURCE } from "./constants";
import {
  describeHandbookError,
  GITHUB_BRANCH_EXISTS_MESSAGE,
  GITHUB_BUSY_MESSAGE,
  GITHUB_KEY_MESSAGE,
  GITHUB_NO_COMMITS_MESSAGE,
  GITHUB_NOT_FOUND_MESSAGE,
  GITHUB_PR_EXISTS_MESSAGE,
  GITHUB_PR_REFUSED_MESSAGE,
  GITHUB_REF_MOVED_MESSAGE,
  githubAccessMessage,
  HANDBOOK_GITHUB_REQUEST_KINDS,
  handbookErrorText,
  handbookGithubErrorCode,
  parseHandbookErrorCode,
} from "./github-errors";

const CODE_PATTERN = new RegExp(HANDBOOK_ERROR_CODE_REGEX_SOURCE);

describe("handbook GitHub error codes (DOC-14)", () => {
  it("are <kind>.<status> and always fit the error_code CHECK", () => {
    expect(handbookGithubErrorCode("installation_token", 422)).toBe("installation_token.422");
    for (const kind of HANDBOOK_GITHUB_REQUEST_KINDS) {
      for (const status of [
        401,
        403,
        404,
        409,
        422,
        429,
        500,
        503,
        "timeout",
        "network",
      ] as const) {
        const code = handbookGithubErrorCode(kind, status);
        expect(code).toMatch(CODE_PATTERN);
        expect(parseHandbookErrorCode(code)).toEqual({ kind, status });
      }
    }
  });

  it("still read the old github_<status> codes stored on publications", () => {
    expect(parseHandbookErrorCode("github_422")).toEqual({ kind: null, status: 422 });
    expect(describeHandbookError("github_422")).toBe("GitHub refused a request (HTTP 422).");
    expect(describeHandbookError("github_timeout")).toMatch(/didn't answer/);
    expect(describeHandbookError("github_503")).toBe(GITHUB_BUSY_MESSAGE);
    expect(parseHandbookErrorCode("bad_path")).toBeNull();
    expect(parseHandbookErrorCode("unknown_kind.422")).toBeNull();
  });
});

describe("describeHandbookError (DOC-14 classification)", () => {
  const access = githubAccessMessage("Stockkart/engineering-handbook");

  it.each([
    ["installation_token.401", null, GITHUB_KEY_MESSAGE],
    ["bad_private_key", null, GITHUB_KEY_MESSAGE],
    ["installation_token.403", null, access],
    ["installation_token.404", null, access],
    ["installation_token.422", null, access],
    ["token_scope", null, access],
    ["get_repo.404", null, GITHUB_NOT_FOUND_MESSAGE],
    ["get_ref.404", null, GITHUB_NOT_FOUND_MESSAGE],
    ["create_branch.422", "ref_exists", GITHUB_BRANCH_EXISTS_MESSAGE],
    ["create_branch.422", null, GITHUB_BRANCH_EXISTS_MESSAGE],
    ["create_branch.422", "other", "GitHub refused the create_branch request (HTTP 422)."],
    ["open_pull_request.422", "no_commits", GITHUB_NO_COMMITS_MESSAGE],
    ["open_pull_request.422", "pr_exists", GITHUB_PR_EXISTS_MESSAGE],
    ["open_pull_request.422", "other", GITHUB_PR_REFUSED_MESSAGE],
    ["open_pull_request.422", null, GITHUB_PR_REFUSED_MESSAGE],
    ["update_ref.422", null, GITHUB_REF_MOVED_MESSAGE],
    ["get_file.429", null, GITHUB_BUSY_MESSAGE],
    ["installation_token.500", null, GITHUB_BUSY_MESSAGE],
    ["open_pull_request.502", null, GITHUB_BUSY_MESSAGE],
    ["list_tree.403", "rate_limited", GITHUB_BUSY_MESSAGE],
    ["get_file.403", "other", "GitHub refused the get_file request (HTTP 403)."],
    ["create_tree.422", null, "GitHub refused the create_tree request (HTTP 422)."],
    ["get_repo.401", null, "GitHub refused the get_repo request (HTTP 401)."],
  ] as const)("%s (%s)", (code, hint, expected) => {
    expect(describeHandbookError(code, { hint })).toBe(expected);
  });

  it("names the App's required access for the token 422 (the usual setup problem)", () => {
    expect(access).toContain("Stockkart/engineering-handbook");
    expect(access).toContain("make sure engineering-handbook is selected");
    expect(access).toContain("accept any pending permission request");
    expect(access).toContain(
      "Contents: Read and write, Pull requests: Read and write, Metadata: Read",
    );
  });

  it("only a busy GitHub says to try again later", () => {
    const codes = HANDBOOK_GITHUB_REQUEST_KINDS.flatMap((kind) =>
      [401, 403, 404, 409, 422].map((status) => handbookGithubErrorCode(kind, status)),
    );
    for (const code of codes) expect(describeHandbookError(code)).not.toMatch(/later|minute/);
    expect(GITHUB_BUSY_MESSAGE).toBe("GitHub is busy; try again in a minute.");
  });

  it("shows the reason with its code", () => {
    expect(handbookErrorText("update_ref.422")).toBe(
      "The handbook changed while publishing; try again (update_ref.422).",
    );
    expect(handbookErrorText("weird_code")).toBe("Handbook sync failed (weird_code).");
  });
});
