// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type NotificationView } from "@/lib/notifications/views";

const actions = vi.hoisted(() => ({
  loadBellAction: vi.fn(),
  markNotificationReadAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}));
vi.mock("@/server/actions/notifications", () => actions);
// A plain anchor that does not navigate (jsdom has no router).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    onClick,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

const { NotificationBell } = await import("./notification-bell");

const item = (id: string, read: boolean): NotificationView => ({
  id,
  type: "assigned",
  actorName: "Ada",
  fromGithub: false,
  target: { kind: "issue", key: `STK-${id}`, title: `Issue ${id}`, href: `/STK/issues/STK-${id}` },
  statusFrom: null,
  statusTo: null,
  commentId: null,
  read,
  createdAt: new Date(),
});

describe("NotificationBell (NTF-1)", () => {
  beforeEach(() => {
    actions.loadBellAction.mockReset().mockResolvedValue({
      ok: true,
      data: { items: [item("1", false), item("2", false)], unread: 2 },
    });
    actions.markNotificationReadAction.mockReset().mockResolvedValue({ ok: true, data: undefined });
    actions.markAllNotificationsReadAction
      .mockReset()
      .mockResolvedValue({ ok: true, data: { marked: 2 } });
  });

  it("shows the unread count from the layout and loads the latest on open", async () => {
    const user = userEvent.setup();
    render(<NotificationBell initialUnread={2} />);
    const bell = screen.getByRole("button", { name: "Notifications, 2 unread" });
    await user.click(bell);
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    const links = await within(dialog).findAllByRole("link", { name: /assigned you/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/STK/issues/STK-1");
    expect(links[0]).toHaveTextContent("Unread");
    expect(actions.loadBellAction).toHaveBeenCalledTimes(1);
  });

  it("marks one read on click (optimistically) and rolls back on failure", async () => {
    const user = userEvent.setup();
    render(<NotificationBell initialUnread={2} />);
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    const [first] = await screen.findAllByRole("link", { name: /assigned you STK-1/ });
    if (!first) throw new Error("no entry");
    await user.click(first);
    expect(actions.markNotificationReadAction).toHaveBeenCalledWith({ notificationId: "1" });
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();

    // Reopen (the server now has one unread); a refused mark puts the count back.
    actions.loadBellAction.mockResolvedValue({
      ok: true,
      data: { items: [item("1", true), item("2", false)], unread: 1 },
    });
    actions.markNotificationReadAction.mockResolvedValue({ ok: false, error: "Nope" });
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    const [, second] = await screen.findAllByRole("link", { name: /assigned you/ });
    if (!second) throw new Error("no entry");
    await user.click(second);
    expect(actions.markNotificationReadAction).toHaveBeenLastCalledWith({ notificationId: "2" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument(),
    );
  });

  it("marks all read", async () => {
    const user = userEvent.setup();
    render(<NotificationBell initialUnread={2} />);
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    await within(dialog).findAllByRole("link", { name: /assigned you/ });
    await user.click(within(dialog).getByRole("button", { name: "Mark all read" }));
    expect(actions.markAllNotificationsReadAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("Read")).toHaveLength(2);
  });
});
