// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/STK/backlog", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.query),
}));

const { RememberView, rememberedHref, useRememberedHref } = await import("./last-view");

function Probe({ href }: { href: string }) {
  return <a href={useRememberedHref(href)}>link</a>;
}

describe("remembered views (VW-5)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    nav.pathname = "/STK/backlog";
    nav.query = "";
  });

  it("stores the page's query and links reopen it", () => {
    nav.query = "status=s1&group=epic";
    render(
      <>
        <RememberView />
        <Probe href="/STK/backlog" />
        <Probe href="/STK/board" />
      </>,
    );
    const [backlog, board] = screen.getAllByRole("link");
    expect(backlog).toHaveAttribute("href", "/STK/backlog?status=s1&group=epic");
    // Each page has its own memory.
    expect(board).toHaveAttribute("href", "/STK/board");
    expect(rememberedHref("/STK/backlog")).toBe("/STK/backlog?status=s1&group=epic");
    expect(rememberedHref("/STK/issues")).toBe("/STK/issues");
  });

  it("forgets the view when the page is back on its plain URL (Clear filters)", () => {
    nav.query = "status=s1";
    const { rerender } = render(
      <>
        <RememberView />
        <Probe href="/STK/backlog" />
      </>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/STK/backlog?status=s1");
    nav.query = "";
    rerender(
      <>
        <RememberView />
        <Probe href="/STK/backlog" />
      </>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/STK/backlog");
    expect(window.localStorage.getItem("hq.last-view:/STK/backlog")).toBeNull();
  });

  it("picks up a view stored in another tab", () => {
    render(<Probe href="/STK/board" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/STK/board");
    act(() => {
      window.localStorage.setItem("hq.last-view:/STK/board", "scope=all");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/STK/board?scope=all");
  });

  it("stores nothing for pages that do not remember", () => {
    nav.pathname = "/STK/issues";
    nav.query = "status=s1";
    render(<RememberView />);
    expect(window.localStorage.length).toBe(0);
  });
});
