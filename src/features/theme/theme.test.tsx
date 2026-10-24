// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { themeCookie } from "@/lib/theme/theme";
import { resetThemeDom, stubColorScheme } from "@/test/theme-dom";

import { ThemeSwitcher } from "./theme-switcher";
import { useResolvedTheme } from "./use-resolved-theme";

beforeEach(() => {
  resetThemeDom();
  document.head.innerHTML = "";
});

/** Changes the `<html>` class (a MutationObserver delivers it asynchronously). */
async function setHtmlClass(className: string) {
  await act(async () => {
    document.documentElement.className = className;
    await Promise.resolve();
  });
}

describe("useResolvedTheme", () => {
  it("follows the html class", async () => {
    stubColorScheme(false);
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
    await setHtmlClass("dark");
    await waitFor(() => expect(result.current).toBe("dark"));
    await setHtmlClass("");
    await waitFor(() => expect(result.current).toBe("light"));
  });

  it("follows prefers-color-scheme in system mode only", async () => {
    const scheme = stubColorScheme(false);
    resetThemeDom("theme-system");
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
    act(() => scheme.setDark(true));
    expect(result.current).toBe("dark");
    // An explicit light choice ignores the OS.
    await setHtmlClass("");
    await waitFor(() => expect(result.current).toBe("light"));
    act(() => scheme.setDark(false));
    act(() => scheme.setDark(true));
    expect(result.current).toBe("light");
  });

  it("treats a missing matchMedia as light in system mode", () => {
    resetThemeDom("theme-system");
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
  });
});

describe("ThemeSwitcher", () => {
  it("shows the current choice and applies a new one by keyboard: class, cookie, theme-color", async () => {
    stubColorScheme(false);
    resetThemeDom("theme-system");
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a">';
    const user = userEvent.setup();
    render(<ThemeSwitcher initialPreference="system" />);

    const trigger = screen.getByRole("button", { name: "Theme: System" });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: "System" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Opening by keyboard focuses the first option; arrow keys move; Enter picks one.
    await waitFor(() =>
      expect(within(menu).getByRole("menuitemradio", { name: "System" })).toHaveFocus(),
    );
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() =>
      expect(within(menu).getByRole("menuitemradio", { name: "Dark" })).toHaveFocus(),
    );
    await user.keyboard("{Enter}");

    expect(document.documentElement.className).toBe("dark");
    expect(document.cookie).toContain("hq_theme=dark");
    const metas = [...document.head.querySelectorAll('meta[name="theme-color"]')];
    expect(metas.map((meta) => meta.getAttribute("content"))).toEqual(["#0a0a0a", "#0a0a0a"]);
    // No reload: the same trigger now names the new choice, and focus returns to it.
    expect(await screen.findByRole("button", { name: "Theme: Dark" })).toHaveFocus();
  });

  it("switches to light (no class) and back to system; every switcher stays in sync", async () => {
    stubColorScheme(true);
    resetThemeDom("dark");
    const user = userEvent.setup();
    render(
      <>
        <ThemeSwitcher initialPreference="dark" />
        <ThemeSwitcher initialPreference="dark" variant="labelled" />
      </>,
    );
    const [iconTrigger] = screen.getAllByRole("button", { name: "Theme: Dark" });
    if (!iconTrigger) throw new Error("no trigger");
    await user.click(iconTrigger);
    await user.click(await screen.findByRole("menuitemradio", { name: "Light" }));
    expect(document.documentElement.className).toBe("");
    expect(document.cookie).toContain("hq_theme=light");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Theme: Light" })).toHaveLength(2),
    );
    // The labelled variant shows the choice as text.
    expect(screen.getAllByRole("button", { name: "Theme: Light" })[1]).toHaveTextContent("Light");

    const [lightTrigger] = screen.getAllByRole("button", { name: "Theme: Light" });
    if (!lightTrigger) throw new Error("no trigger");
    await user.click(lightTrigger);
    await user.click(await screen.findByRole("menuitemradio", { name: "System" }));
    expect(document.documentElement.className).toBe("theme-system");
    expect(document.cookie).toContain("hq_theme=system");
  });
});

describe("themeCookie", () => {
  it("is path=/, SameSite=Lax, one year, not HttpOnly; Secure on https", () => {
    expect(themeCookie("dark", { secure: false })).toBe(
      "hq_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(themeCookie("light", { secure: true })).toBe(
      "hq_theme=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
  });
});
