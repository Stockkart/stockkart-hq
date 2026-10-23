import { describe, expect, it } from "vitest";

import { notificationActor, notificationHref, notificationText, unreadBadge } from "./format";
import { type NotificationView } from "./views";

const issue = {
  kind: "issue",
  key: "STK-12",
  title: "OCR pool",
  href: "/STK/issues/STK-12",
} as const;
const view = (overrides: Partial<NotificationView>): NotificationView => ({
  id: "n1",
  type: "assigned",
  actorName: "Ada",
  fromGithub: false,
  target: issue,
  statusFrom: null,
  statusTo: null,
  commentId: null,
  read: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("notification wording (NTF-1)", () => {
  it("words each event", () => {
    expect(notificationText(view({ type: "assigned" }))).toBe("assigned you STK-12");
    expect(notificationText(view({ type: "mentioned" }))).toBe("mentioned you in STK-12");
    expect(notificationText(view({ type: "mentioned", commentId: "c1" }))).toBe(
      "mentioned you in a comment on STK-12",
    );
    expect(
      notificationText(
        view({
          type: "mentioned_in_doc",
          target: { kind: "doc", title: "Plan", href: "/STK/docs/d" },
        }),
      ),
    ).toBe("mentioned you in “Plan”");
    expect(
      notificationText(
        view({
          type: "mentioned_in_doc",
          commentId: "c1",
          target: { kind: "doc", title: "Plan", href: "/STK/docs/d" },
        }),
      ),
    ).toBe("mentioned you in a comment on “Plan”");
    expect(notificationText(view({ type: "comment_on_watched" }))).toBe("commented on STK-12");
    expect(
      notificationText(
        view({
          type: "comment_on_doc",
          target: { kind: "doc", title: "Plan", href: "/STK/docs/d" },
        }),
      ),
    ).toBe("commented on “Plan”");
    expect(notificationText(view({ type: "comment_on_doc", target: null }))).toBe(
      "commented on a doc that was deleted",
    );
    expect(notificationText(view({ type: "incident_commander", target: null }))).toBe(
      "made you the commander of an incident that was deleted",
    );
    expect(
      notificationText(
        view({ type: "status_on_watched", statusFrom: "Backlog", statusTo: "Done" }),
      ),
    ).toBe("moved STK-12 from Backlog to Done");
    expect(notificationText(view({ type: "status_on_watched", statusTo: "Done" }))).toBe(
      "moved STK-12 to Done",
    );
  });

  it("says what happened even when the target was deleted", () => {
    expect(notificationText(view({ target: null }))).toBe("assigned you an issue that was deleted");
    expect(notificationHref(view({ target: null }))).toBeNull();
  });

  it("names GitHub for GitHub-driven moves and links comments to their anchor", () => {
    expect(notificationActor(view({ actorName: null, fromGithub: true }))).toBe("GitHub");
    expect(notificationActor(view({ actorName: null }))).toBe("Someone");
    expect(notificationHref(view({ commentId: "c1" }))).toBe("/STK/issues/STK-12#comment-c1");
    expect(notificationHref(view({}))).toBe("/STK/issues/STK-12");
    // DOC-13: doc comments open their thread in the doc's comments panel.
    const doc = { kind: "doc", title: "Spec", href: "/STK/docs/d1" } as const;
    expect(notificationHref(view({ target: doc, commentId: "c2" }))).toBe(
      "/STK/docs/d1#comment-c2",
    );
    expect(notificationHref(view({ target: doc }))).toBe("/STK/docs/d1");
  });

  it("caps the badge", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(100)).toBe("99+");
  });

  it("words the COST-7 reminder as a system event linking to the month", () => {
    const costs = {
      kind: "costs",
      title: "October 2026 costs",
      href: "/STK/costs?month=2026-10",
    } as const;
    const reminder = view({
      type: "cost_reminder",
      actorName: null,
      target: costs,
      costReminder: { month: "2026-10", missingCount: 5 },
    });
    expect(notificationActor(reminder)).toBe("Stockkart HQ");
    expect(notificationText(reminder)).toBe(
      "reminds you: October 2026 costs are not added yet (5 items missing)",
    );
    expect(notificationHref(reminder)).toBe("/STK/costs?month=2026-10");
    expect(
      notificationText({ ...reminder, costReminder: { month: "2026-10", missingCount: 1 } }),
    ).toContain("(1 item missing)");
    expect(notificationText({ ...reminder, costReminder: null })).toBe(
      "reminds you to add last month's costs",
    );
  });
});
