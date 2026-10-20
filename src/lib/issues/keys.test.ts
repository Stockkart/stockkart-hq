import { describe, expect, it } from "vitest";

import { branchName, extractIssueRefs, parseIssueKey, slugify, splitIssueRefs } from "./keys";

describe("issue references (ISS-7)", () => {
  const keys = ["STK"];

  it("extracts unique refs of known projects, in order", () => {
    expect(extractIssueRefs("Fixes STK-42, see STK-7 and STK-42 again", keys)).toEqual([
      { projectKey: "STK", number: 42 },
      { projectKey: "STK", number: 7 },
    ]);
  });

  it("ignores unknown prefixes, lower case, embedded matches and zero", () => {
    expect(extractIssueRefs("UTF-8 SHA-256 stk-1 XSTK-3 STK-0 STK-12abc", keys)).toEqual([]);
  });

  it("matches refs next to punctuation and at line edges", () => {
    expect(extractIssueRefs("(STK-1)\nSTK-2.\n[STK-3]", keys).map((ref) => ref.number)).toEqual([
      1, 2, 3,
    ]);
  });

  it("splits text into plain runs and ref chips", () => {
    expect(splitIssueRefs("see STK-5 now", keys)).toEqual([
      { kind: "text", text: "see " },
      { kind: "ref", text: "STK-5", ref: { projectKey: "STK", number: 5 } },
      { kind: "text", text: " now" },
    ]);
    expect(splitIssueRefs("nothing here", keys)).toEqual([{ kind: "text", text: "nothing here" }]);
  });

  it("parses keys case-insensitively and rejects junk", () => {
    expect(parseIssueKey(" stk-12 ")).toEqual({ projectKey: "STK", number: 12 });
    expect(parseIssueKey("STK-0")).toBeNull();
    expect(parseIssueKey("STK-99999999999")).toBeNull();
    expect(parseIssueKey("S-1")).toBeNull();
    expect(parseIssueKey("STK12")).toBeNull();
  });
});

describe("branch names (GH-5)", () => {
  it("is the lower-case key plus a short slug", () => {
    expect(branchName("STK-42", "OOM restart on 10 MB OCR upload")).toBe(
      "stk-42-oom-restart-on-10-mb-ocr-upload",
    );
  });

  it("strips accents and punctuation", () => {
    expect(slugify("Café: fix “quotes” & ümlauts!")).toBe("cafe-fix-quotes-umlauts");
  });

  it("cuts at a word boundary within 40 characters", () => {
    const slug = slugify(
      "Add ShedLock to every scheduled job so two containers never double-run them",
    );
    expect(slug).toBe("add-shedlock-to-every-scheduled-job-so");
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it("truncates a single over-long word and falls back to the key", () => {
    expect(slugify("a".repeat(60))).toHaveLength(40);
    expect(branchName("STK-1", "!!!")).toBe("stk-1");
  });
});
