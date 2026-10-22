// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setWatchingAction = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/watchers", () => ({ setWatchingAction }));

const { WatchersPanel } = await import("./watchers-panel");

const ISSUE = "33333333-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const me = { id: "u-me", name: "Me Myself", email: "me@example.test" };
const ada = { id: "u-ada", name: "Ada Lovelace", email: "ada@example.test" };

describe("WatchersPanel (ISS-11)", () => {
  beforeEach(() => {
    setWatchingAction.mockReset().mockResolvedValue({ ok: true, data: { watching: true } });
  });

  it("shows the count and avatars, and watches at once", async () => {
    const user = userEvent.setup();
    render(<WatchersPanel issueId={ISSUE} watchers={[ada]} currentUser={me} />);
    expect(screen.getByRole("heading", { name: "Watchers (1)" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "People watching" });
    expect(within(list).getByText("Ada Lovelace")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Watch" }));
    expect(setWatchingAction).toHaveBeenCalledWith({ issueId: ISSUE, watching: true });
    expect(screen.getByRole("heading", { name: "Watchers (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unwatch" })).toHaveAttribute("aria-pressed", "true");
  });

  it("rolls back when the server refuses", async () => {
    setWatchingAction.mockResolvedValue({ ok: false, error: "Issue not found" });
    const user = userEvent.setup();
    render(<WatchersPanel issueId={ISSUE} watchers={[ada, me]} currentUser={me} />);
    await user.click(screen.getByRole("button", { name: "Unwatch" }));
    expect(setWatchingAction).toHaveBeenCalledWith({ issueId: ISSUE, watching: false });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Watchers (2)" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Unwatch" })).toBeInTheDocument();
  });
});
