import { describe, expect, it } from "vitest";

import { formatIssueKey, type IssueRef } from "@/lib/issues/keys";

import {
  extractIssueKeys,
  GITHUB_LOGIN_PATTERN,
  MAX_KEYS_PER_TEXT,
  parseClosingKeys,
} from "./refs";
import { githubLoginInput } from "./schemas";

const keys = (refs: IssueRef[]) => refs.map((ref) => formatIssueKey(ref.projectKey, ref.number));

describe("extractIssueKeys (GH-2)", () => {
  it("matches keys in any case and upper-cases them", () => {
    expect(keys(extractIssueKeys("STK-1 stk-2 Stk-3"))).toEqual(["STK-1", "STK-2", "STK-3"]);
  });

  it("finds keys in GH-5 branch names", () => {
    expect(keys(extractIssueKeys("stk-42-oom-ocr"))).toEqual(["STK-42"]);
    expect(keys(extractIssueKeys("feature/stk-7_x"))).toEqual([]);
    expect(keys(extractIssueKeys("feature/stk-7-x"))).toEqual(["STK-7"]);
    expect(keys(extractIssueKeys("refs/heads/STK-9"))).toEqual(["STK-9"]);
  });

  it("returns multiple keys once each, in order, across texts", () => {
    expect(keys(extractIssueKeys("STK-2 and STK-1", "again STK-2, ABC-3", null))).toEqual([
      "STK-2",
      "STK-1",
      "ABC-3",
    ]);
  });

  it("has no false positives for STK", () => {
    // Glued prefixes are a different (or no) key, never STK-1.
    expect(keys(extractIssueKeys("XSTK-1"))).toEqual(["XSTK-1"]);
    expect(keys(extractIssueKeys("ABXSTK-1 1STK-1 STK-1a STK_1 STK1 STK-0 STK-"))).toEqual([]);
    expect(keys(extractIssueKeys("STK-12345678901"))).toEqual([]);
  });

  it("is bounded per text", () => {
    const many = Array.from({ length: 80 }, (_, index) => `STK-${index + 1}`).join(" ");
    expect(extractIssueKeys(many)).toHaveLength(MAX_KEYS_PER_TEXT);
  });
});

describe("parseClosingKeys (GH-3)", () => {
  it.each([
    "close",
    "closes",
    "closed",
    "fix",
    "fixes",
    "fixed",
    "resolve",
    "resolves",
    "resolved",
    "Closes",
    "FIXES",
    "Resolved",
  ])("accepts %s, with or without a colon", (word) => {
    expect(keys(parseClosingKeys(`${word} STK-1`))).toEqual(["STK-1"]);
    expect(keys(parseClosingKeys(`${word}: stk-1`))).toEqual(["STK-1"]);
    expect(keys(parseClosingKeys(`${word}:STK-1`))).toEqual(["STK-1"]);
  });

  it("accepts several keys after one keyword", () => {
    expect(keys(parseClosingKeys("fixes STK-1, STK-2"))).toEqual(["STK-1", "STK-2"]);
    expect(keys(parseClosingKeys("Closes STK-1, STK-2 and STK-3 & STK-4"))).toEqual([
      "STK-1",
      "STK-2",
      "STK-3",
      "STK-4",
    ]);
  });

  it("finds keywords in the title and the body", () => {
    expect(
      keys(parseClosingKeys("Fix OCR (fixes STK-5)", "Some text.\n\nResolves STK-6\nfixes STK-5")),
    ).toEqual(["STK-5", "STK-6"]);
  });

  it.each([
    "prefix STK-1",
    "not fixing STK-1",
    "fixture STK-1",
    "closest STK-1",
    "STK-1",
    "relates to STK-1",
    "fixes #12",
    "fixes XSTK-1x",
  ])("closes nothing for %j", (text) => {
    expect(parseClosingKeys(text)).toEqual([]);
  });

  it("stops at the first key that is not joined by a separator", () => {
    expect(keys(parseClosingKeys("fixes STK-1 before STK-2"))).toEqual(["STK-1"]);
  });
});

describe("GitHub username rules (profile)", () => {
  it.each(["a", "octocat", "imf-ali", "A1-b2-C3", "x".repeat(39)])("accepts %s", (login) => {
    expect(GITHUB_LOGIN_PATTERN.test(login)).toBe(true);
  });

  it.each(["", "-a", "a-", "a--b", "x".repeat(40), "a_b", "a.b", "a b", "ünï"])(
    "rejects %j",
    (login) => {
      expect(GITHUB_LOGIN_PATTERN.test(login)).toBe(false);
    },
  );

  it("trims, drops a leading @ and turns empty into null", () => {
    expect(githubLoginInput.parse({ githubLogin: "  @Imf-Ali " })).toEqual({
      githubLogin: "Imf-Ali",
    });
    expect(githubLoginInput.parse({ githubLogin: "   " })).toEqual({ githubLogin: null });
    expect(githubLoginInput.safeParse({ githubLogin: "bad--name" }).success).toBe(false);
  });
});
