import { describe, expect, it } from "vitest";

import { type NotificationView } from "@/lib/notifications/views";

import { appLink, buildDigestEmail } from "./digest-content";
import { escapeHtml } from "./html";

const BASE = "https://hq.example.test";
const UNSUBSCRIBE = `${BASE}/unsubscribe?token=${"a".repeat(43)}`;

const view = (overrides: Partial<NotificationView>): NotificationView => ({
  id: "n1",
  type: "comment_on_doc",
  actorName: "Ada",
  fromGithub: false,
  target: { kind: "doc", title: "Spec", href: "/STK/docs/d1" },
  statusFrom: null,
  statusTo: null,
  commentId: "c1",
  read: false,
  createdAt: new Date(0),
  ...overrides,
});

describe("digest email content (NTF-2)", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes every user-controlled value in the HTML part", () => {
    const evil = view({
      actorName: `<img src=x onerror="alert(1)">`,
      target: { kind: "doc", title: `</a><script>alert("t")</script>`, href: "/STK/docs/d1" },
    });
    const { html, text, subject } = buildDigestEmail({
      items: [evil],
      total: 1,
      baseUrl: BASE,
      unsubscribeUrl: UNSUBSCRIBE,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;");
    expect(html).toContain(`href="${BASE}/STK/docs/d1#comment-c1"`);
    // The plain-text part is plain text.
    expect(text).toContain(`${BASE}/STK/docs/d1#comment-c1`);
    expect(subject).toBe("Stockkart HQ: 1 unread notification");
  });

  it("links each item to APP_BASE_URL + its path, says how many more, and has the footer", () => {
    const items = [view({}), view({ id: "n2", target: null, type: "assigned" })];
    const { html, text } = buildDigestEmail({
      items,
      total: 57,
      baseUrl: BASE,
      unsubscribeUrl: UNSUBSCRIBE,
    });
    expect(text).toContain(
      "- Ada commented on “Spec”\n  https://hq.example.test/STK/docs/d1#comment-c1",
    );
    expect(text).toContain("- Ada assigned you an issue that was deleted\n");
    expect(text).toContain(`…and 55 more: ${BASE}/notifications`);
    expect(text).toContain(`Unsubscribe: ${UNSUBSCRIBE}`);
    expect(html).toContain(`<a href="${escapeHtml(UNSUBSCRIBE)}">Unsubscribe</a>`);
    expect(html).toContain("…and 55 more");
  });

  it("only links app paths", () => {
    expect(appLink(BASE, "/STK/issues/STK-1")).toBe(`${BASE}/STK/issues/STK-1`);
    expect(appLink(BASE, "//evil.example")).toBeNull();
    expect(appLink(BASE, "https://evil.example")).toBeNull();
    expect(appLink(BASE, null)).toBeNull();
  });
});
