import { describe, expect, it } from "vitest";

import { extractIssueRefs } from "@/lib/issues/keys";
import { extractPlainText, rt } from "@/lib/rich-text";

import { buildRetroDoc, retroTitle } from "./retro";

describe("sprint retro doc (SPR-5)", () => {
  const template = rt.doc(rt.heading(2, "Went well"), rt.bullets(""));

  it("starts with the sprint's goal, dates, completed and carried issues, then the template", () => {
    const doc = buildRetroDoc({
      sprint: {
        name: "Sprint 4",
        goal: "Ship OCR",
        startDate: "2026-06-01",
        endDate: "2026-06-14",
      },
      completed: [
        { key: "STK-12", title: "Upload flow", points: 5 },
        { key: "STK-13", title: "Docs", points: null },
      ],
      carried: [{ key: "STK-20", title: "Retry queue", points: 1 }],
      template,
    });
    const text = extractPlainText(doc);
    expect(text).toContain("Goal: Ship OCR");
    expect(text).toContain("Dates: Jun 1 – Jun 14");
    expect(text).toContain("Completed 2 issues (5 points); carried over 1 issue (1 point).");
    expect(text).toContain("STK-12 Upload flow (5 pts)");
    expect(text).toContain("STK-13 Docs");
    expect(text).toContain("STK-20 Retry queue (1 pt)");
    // The keys are plain text: the doc renders them as chips and links them as mentions.
    expect(extractIssueRefs(text, ["STK"]).map((ref) => ref.number)).toEqual([12, 13, 20]);
    expect(doc.content?.at(-2)).toEqual(template.content?.[0]);
  });

  it("says when a list is empty or there was no goal, and works without the template", () => {
    const text = extractPlainText(
      buildRetroDoc({
        sprint: { name: "S", goal: null, startDate: null, endDate: null },
        completed: [],
        carried: [],
        template: null,
      }),
    );
    expect(text).toContain("Goal: No goal was set.");
    expect(text).toContain("None.");
  });

  it("titles it after the sprint, within the doc title limit", () => {
    expect(retroTitle("Sprint 4")).toBe("Retro — Sprint 4");
    expect(retroTitle("x".repeat(300))).toHaveLength(255);
  });
});
