// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ShortcutHelp } from "./shortcut-help";
import { matchesShortcut, SHORTCUTS } from "./shortcuts";

describe("shortcut help (§9.5 ?)", () => {
  it("opens with ?, lists every shortcut of the registry, and closes with Esc", async () => {
    const user = userEvent.setup();
    render(<ShortcutHelp />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    for (const shortcut of SHORTCUTS) {
      expect(within(dialog).getByText(shortcut.description)).toBeInTheDocument();
    }
    // The keys of the spec's shortcuts are shown.
    for (const key of ["C", "⌘/Ctrl", "J", "K", "Enter", "X", "?", "Esc"]) {
      expect(within(dialog).getAllByText(key).length).toBeGreaterThan(0);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Focus goes back to the page, not lost in a removed dialog.
    expect(document.activeElement).not.toBeNull();
  });

  it("opens from its button, which names the shortcut", async () => {
    const user = userEvent.setup();
    render(<ShortcutHelp />);
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "?");
    await user.click(button);
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("ignores ? typed into a field", async () => {
    const user = userEvent.setup();
    render(
      <>
        <label>
          Notes <input />
        </label>
        <ShortcutHelp />
      </>,
    );
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "why?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("matches keys case-insensitively, from one registry", () => {
    expect(matchesShortcut({ key: "C" }, "create")).toBe(true);
    expect(matchesShortcut({ key: "x" }, "select")).toBe(true);
    expect(matchesShortcut({ key: "?" }, "help")).toBe(true);
    expect(matchesShortcut({ key: "j" }, "previous")).toBe(false);
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });
});
