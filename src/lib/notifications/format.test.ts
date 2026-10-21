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
    expect(notificationText(view({ type: "comment_on_watched" }))).toBe("commented on STK-12");
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
  });

  it("caps the badge", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(100)).toBe("99+");
  });
});
