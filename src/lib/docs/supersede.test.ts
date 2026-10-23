import { describe, expect, it } from "vitest";

import { extractPlainText, type RichTextDoc, rt } from "@/lib/rich-text";
import { BUILT_IN_DOC_TEMPLATES } from "@/lib/templates/doc-templates";

import { withSupersedesBullet } from "./supersede";

const link = (doc: RichTextDoc) => JSON.stringify(doc).match(/"href":"([^"]+)"/)?.[1];

describe("withSupersedesBullet (ADR-3)", () => {
  it("replaces the ADR template's Supersedes placeholder in Context", () => {
    const template = BUILT_IN_DOC_TEMPLATES.find((item) => item.subtype === "adr")?.content ?? null;
    const doc = withSupersedesBullet(template, { number: 7, href: "0007-use-cron.md" });
    const text = extractPlainText(doc);
    expect(text).toContain("Supersedes: 0007");
    expect(text).not.toContain("Supersedes: NNNN");
    expect(link(doc)).toBe("0007-use-cron.md");
    // The other Context bullets stay.
    expect(text).toContain("The force or problem, as visible in code.");
  });

  it("goes first in a Context list without a placeholder, or under the heading", () => {
    const listed = withSupersedesBullet(rt.doc(rt.heading(2, "Context"), rt.bullets("Why")), {
      number: 3,
      href: "0003-x.md",
    });
    expect(extractPlainText(listed).split("\n").slice(1, 3)).toEqual(["Supersedes: 0003", "Why"]);
    const bare = withSupersedesBullet(rt.doc(rt.heading(2, "Context"), rt.paragraph("p")), {
      number: 3,
      href: "0003-x.md",
    });
    expect(extractPlainText(bare).split("\n")[1]).toBe("Supersedes: 0003");
  });

  it("adds a Context section when there is none (or no template)", () => {
    const doc = withSupersedesBullet(null, { number: 12, href: "0012-y.md" });
    expect(extractPlainText(doc).split("\n").slice(0, 2)).toEqual(["Context", "Supersedes: 0012"]);
  });
});
