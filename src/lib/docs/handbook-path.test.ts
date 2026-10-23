import { describe, expect, it } from "vitest";

import {
  defaultHandbookPath,
  handbookFileName,
  handbookPathFor,
  handbookRelativeLink,
  handbookSlug,
  handbookUpperSnake,
  isHandbookPath,
} from "./handbook-path";

describe("handbook paths (DOC-12, DOC-14)", () => {
  it.each([
    "README.md",
    "ARCHITECTURE.md",
    "decisions/0004-ocr-provider.md",
    "guides/how_to-run.v2.md",
    "-dash.md",
  ])("accepts %j", (path) => {
    expect(isHandbookPath(path)).toBe(true);
  });

  it.each([
    ["traversal", "../secrets.md"],
    ["inner traversal", "decisions/../../x.md"],
    ["double dot in a name", "a..b.md"],
    ["absolute", "/etc/passwd.md"],
    ["hidden directory", ".github/workflows/x.md"],
    ["hidden file", "decisions/.x.md"],
    ["not markdown", "decisions/0004-x.yml"],
    ["upper-case extension", "README.MD"],
    ["bare extension", ".md"],
    ["empty segment", "decisions//x.md"],
    ["trailing slash", "decisions/"],
    ["backslash", "decisions\\x.md"],
    ["space", "my doc.md"],
    ["non-ASCII", "café.md"],
    ["newline", "a.md\nb.md"],
    ["too long", `${"a".repeat(198)}.md`],
    ["empty", ""],
  ])("rejects a %s path", (_name, path) => {
    expect(isHandbookPath(path)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isHandbookPath(null)).toBe(false);
    expect(isHandbookPath(42)).toBe(false);
  });

  it("slugs titles as ASCII kebab / upper snake, at most 60 characters on a word boundary", () => {
    expect(handbookSlug("Use a Queue for OCR!")).toBe("use-a-queue-for-ocr");
    expect(handbookSlug("Café — naïve résumé")).toBe("cafe-naive-resume");
    expect(handbookSlug("¿¡")).toBe("untitled");
    const long = handbookSlug("word ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("-")).toBe(false);
    expect(handbookSlug("x".repeat(80))).toBe("x".repeat(60));
    expect(handbookUpperSnake("In-memory state")).toBe("IN_MEMORY_STATE");
    expect(handbookUpperSnake("API contract (v2)")).toBe("API_CONTRACT_V2");
    expect(handbookUpperSnake("…")).toBe("UNTITLED");
  });

  it("defaults ADRs to decisions/NNNN-<slug>.md and other docs to the top level", () => {
    expect(defaultHandbookPath({ type: "adr", title: "0012. Cache widgets", adrNumber: 12 })).toBe(
      "decisions/0012-cache-widgets.md",
    );
    expect(defaultHandbookPath({ type: "runbook", title: "Runbook", adrNumber: null })).toBe(
      "RUNBOOK.md",
    );
    expect(defaultHandbookPath({ type: "page", title: "../../etc", adrNumber: null })).toBe(
      "ETC.md",
    );
    // Never a file GitHub gives a meaning to (license, security policy, readme …).
    expect(defaultHandbookPath({ type: "page", title: "Security", adrNumber: null })).toBe(
      "SECURITY_DOC.md",
    );
    expect(defaultHandbookPath({ type: "page", title: "Readme", adrNumber: null })).toBe(
      "README_DOC.md",
    );
    expect(
      handbookPathFor({ type: "page", title: "Readme", adrNumber: null, sourcePath: "README.md" }),
    ).toBe("README.md");
  });

  it("prefers the override, then the import's source path, skipping invalid ones", () => {
    const doc = { type: "page" as const, title: "Architecture", adrNumber: null };
    expect(handbookPathFor({ ...doc, handbookPath: "docs/ARCH.md", sourcePath: "A.md" })).toBe(
      "docs/ARCH.md",
    );
    expect(handbookPathFor({ ...doc, sourcePath: "ARCHITECTURE.md" })).toBe("ARCHITECTURE.md");
    // The import's group pages have directory source paths ("." / "decisions").
    expect(handbookPathFor({ ...doc, handbookPath: "../x.md", sourcePath: "." })).toBe(
      "ARCHITECTURE.md",
    );
  });

  it("gives file names and relative links between handbook files", () => {
    expect(handbookFileName("decisions/0004-ocr.md")).toBe("0004-ocr.md");
    expect(handbookFileName("README.md")).toBe("README.md");
    expect(handbookRelativeLink("decisions/0004-a.md", "decisions/0010-b.md")).toBe("0010-b.md");
    expect(handbookRelativeLink("README.md", "decisions/0010-b.md")).toBe("decisions/0010-b.md");
    expect(handbookRelativeLink("decisions/0004-a.md", "RUNBOOK.md")).toBe("../RUNBOOK.md");
  });
});
