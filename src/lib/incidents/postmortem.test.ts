import { describe, expect, it } from "vitest";

import { extractIssueRefs } from "@/lib/issues/keys";
import { extractPlainText } from "@/lib/rich-text";
import { BUILT_IN_DOC_TEMPLATES } from "@/lib/templates/doc-templates";

import { buildPostmortem, postmortemTitle } from "./postmortem";

const template = BUILT_IN_DOC_TEMPLATES.find((entry) => entry.subtype === "postmortem")?.content;

const data = {
  incident: {
    key: "INC-3",
    title: "Checkout down",
    severity: "sev1" as const,
    status: "resolved" as const,
    startedAt: new Date("2026-10-20T10:00:00Z"),
    mitigatedAt: new Date("2026-10-20T10:30:00Z"),
    resolvedAt: new Date("2026-10-20T12:15:00Z"),
    summary: "Payments failed for all shops.",
    serviceNames: ["inventory-api", "MongoDB Atlas"],
  },
  timeline: [
    {
      at: new Date("2026-10-20T10:00:00Z"),
      kind: "status_change" as const,
      body: "Incident declared",
    },
    { at: new Date("2026-10-20T10:20:00Z"), kind: "action" as const, body: "Rolled back api-v1.4" },
  ],
  followUps: [{ key: "STK-12", title: "Alert on payment errors" }],
};

describe("buildPostmortem (INC-2)", () => {
  it("fills Summary, Impact, Timeline and Action items of the built-in template", () => {
    const doc = buildPostmortem(template ?? null, data);
    const text = extractPlainText(doc);
    expect(text).toContain("Payments failed for all shops.");
    expect(text).toContain("Severity: SEV1");
    expect(text).toContain("Duration: 2h 15m (mitigated after 30m)");
    expect(text).toContain("Affected services: inventory-api, MongoDB Atlas");
    expect(text).toContain("2026-10-20 10:20 UTC");
    expect(text).toContain("Action: Rolled back api-v1.4");
    // The template's prompt rows are replaced, other sections stay.
    expect(text).not.toContain("What happened, in two sentences.");
    expect(text).toContain("Root cause (5 whys)");
    // Follow-ups are STK keys in the text: chips in the view, mention links on save.
    expect(extractIssueRefs(text, ["STK"])).toEqual([{ projectKey: "STK", number: 12 }]);
  });

  it("keeps the timeline in the given order and appends missing sections", () => {
    const doc = buildPostmortem(null, data);
    const text = extractPlainText(doc);
    expect(text.indexOf("Incident declared")).toBeLessThan(text.indexOf("Rolled back"));
    for (const heading of ["Summary", "Impact", "Timeline", "Action items (linked issues)"]) {
      expect(text).toContain(heading);
    }
  });

  it("titles the doc after the incident", () => {
    expect(postmortemTitle("INC-3", "Checkout down")).toBe("Postmortem — INC-3 Checkout down");
  });
});
