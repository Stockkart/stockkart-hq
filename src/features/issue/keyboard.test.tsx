// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { NAV_ITEM, NAV_LINK, useListNavigation } from "@/features/planning/use-list-navigation";

import { shouldIgnoreShortcut } from "./keyboard";

function keyOn(target: HTMLElement, init: KeyboardEventInit = {}) {
  let ignored: boolean | null = null;
  target.addEventListener("keydown", (event) => (ignored = shouldIgnoreShortcut(event)), {
    once: true,
  });
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, ...init }));
  return ignored;
}

describe("shouldIgnoreShortcut (SPEC §9.5)", () => {
  it("lets a plain key on the page through", () => {
    const div = document.createElement("div");
    document.body.append(div);
    expect(keyOn(div)).toBe(false);
  });

  it.each([
    ["an input", () => document.createElement("input")],
    ["a textarea", () => document.createElement("textarea")],
    ["a select", () => document.createElement("select")],
    [
      "a picker (type-ahead)",
      () => {
        const button = document.createElement("button");
        button.setAttribute("role", "combobox");
        return button;
      },
    ],
    [
      "a rich-text editor",
      () => {
        const div = document.createElement("div");
        div.contentEditable = "true";
        // jsdom does not derive isContentEditable from the attribute.
        Object.defineProperty(div, "isContentEditable", { value: true });
        return div;
      },
    ],
    [
      "a dialog",
      () => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        const button = document.createElement("button");
        dialog.append(button);
        document.body.append(dialog);
        return button;
      },
    ],
  ])("ignores keys typed in %s", (_label, make) => {
    const target = make();
    if (!target.isConnected) document.body.append(target);
    expect(keyOn(target)).toBe(true);
  });

  it.each(["text", "search", "number"])("ignores keys in an input of type %s", (type) => {
    const input = document.createElement("input");
    input.type = type;
    document.body.append(input);
    expect(keyOn(input)).toBe(true);
  });

  it.each(["checkbox", "radio"])("lets keys through on a focused %s (no text)", (type) => {
    const input = document.createElement("input");
    input.type = type;
    document.body.append(input);
    expect(keyOn(input)).toBe(false);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }])(
    "ignores keys with %o",
    (init) => {
      const div = document.createElement("div");
      document.body.append(div);
      expect(keyOn(div, init)).toBe(true);
    },
  );
});

function List() {
  const ref = useRef<HTMLUListElement>(null);
  useListNavigation(ref);
  return (
    <>
      <input aria-label="Filter" />
      <ul ref={ref}>
        {["One", "Two", "Three"].map((name) => (
          <li key={name} {...NAV_ITEM}>
            <a href={`#${name}`} {...NAV_LINK}>
              {name}
            </a>
            <button type="button">{name} menu</button>
          </li>
        ))}
      </ul>
    </>
  );
}

describe("J/K list navigation", () => {
  it("moves focus between rows, clamps at the ends, and starts from a focused row", async () => {
    const user = userEvent.setup();
    render(<List />);
    await user.keyboard("j");
    expect(screen.getByRole("link", { name: "One" })).toHaveFocus();
    await user.keyboard("jj");
    expect(screen.getByRole("link", { name: "Three" })).toHaveFocus();
    await user.keyboard("j");
    expect(screen.getByRole("link", { name: "Three" })).toHaveFocus();
    await user.keyboard("kk");
    expect(screen.getByRole("link", { name: "One" })).toHaveFocus();
    // From a control inside a row, J goes to the next row.
    screen.getByRole("button", { name: "Two menu" }).focus();
    await user.keyboard("j");
    expect(screen.getByRole("link", { name: "Three" })).toHaveFocus();
  });

  it("does nothing while typing in a field", async () => {
    const user = userEvent.setup();
    render(<List />);
    await user.click(screen.getByLabelText("Filter"));
    await user.keyboard("j");
    expect(screen.getByLabelText("Filter")).toHaveFocus();
    expect(screen.getByLabelText("Filter")).toHaveValue("j");
  });
});
