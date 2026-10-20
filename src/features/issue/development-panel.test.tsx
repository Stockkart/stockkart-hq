// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { type CommitView, type DevelopmentView } from "@/lib/github/views";

import { COMMITS_SHOWN, DevelopmentPanel } from "./development-panel";

const repo = "Stockkart/inventory-api";

function commits(count: number): CommitView[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c-${index}`,
    repo,
    sha: `${index}`.padStart(40, "b"),
    message: `STK-1 commit ${index}`,
    url: `https://github.com/${repo}/commit/${index}`,
    author: index === 0 ? { login: "imf-ali", user: { id: "u-1", name: "Imf Ali" } } : null,
    createdAt: new Date(0),
  }));
}

const view: DevelopmentView = {
  branches: [
    {
      id: "b-1",
      repo,
      name: "stk-1-oom-ocr",
      url: `https://github.com/${repo}/tree/stk-1-oom-ocr`,
    },
  ],
  pullRequests: (["open", "draft", "merged", "closed"] as const).map((state, index) => ({
    id: `p-${state}`,
    repo,
    number: 100 + index,
    title: `PR ${state}`,
    url: `https://github.com/${repo}/pull/${100 + index}`,
    state,
    author: { login: "someone", user: null },
    mergedAt: null,
  })),
  commits: commits(7),
};

describe("DevelopmentPanel (GH-4)", () => {
  it("says when nothing is linked", () => {
    render(<DevelopmentPanel development={{ branches: [], pullRequests: [], commits: [] }} />);
    expect(screen.getByText(/Nothing linked yet/)).toBeInTheDocument();
  });

  it("renders branches, PRs with their state, and authors", () => {
    render(<DevelopmentPanel development={view} />);
    const branches = screen.getByRole("region", { name: "Branches (1)" });
    expect(within(branches).getByRole("link", { name: /stk-1-oom-ocr/ })).toHaveAttribute(
      "href",
      `https://github.com/${repo}/tree/stk-1-oom-ocr`,
    );
    const prs = screen.getByRole("region", { name: "Pull requests (4)" });
    for (const label of ["Open", "Draft", "Merged", "Closed"]) {
      expect(within(prs).getByText(label)).toBeInTheDocument();
    }
    expect(within(prs).getByRole("link", { name: /#102 PR merged/ })).toBeInTheDocument();
    expect(within(prs).getAllByText("someone")).toHaveLength(4);
    // A mapped author shows the HQ name, not the login.
    expect(screen.getByText("Imf Ali")).toBeInTheDocument();
  });

  it("opens every link in a new tab without an opener or referrer", () => {
    render(<DevelopmentPanel development={view} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link.getAttribute("href")).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it("shows 5 commits with short shas and toggles the rest", async () => {
    render(<DevelopmentPanel development={view} />);
    const section = screen.getByRole("region", { name: "Commits (7)" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(COMMITS_SHOWN);
    expect(within(section).getAllByRole("link", { name: /^bbbbbbb/ })).toHaveLength(COMMITS_SHOWN);
    const toggle = within(section).getByRole("button", { name: "Show all 7 commits" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(within(section).getAllByRole("listitem")).toHaveLength(7);
    await userEvent.click(within(section).getByRole("button", { name: "Show fewer" }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(COMMITS_SHOWN);
  });

  it("never renders a non-GitHub URL as a link", () => {
    render(
      <DevelopmentPanel
        development={{
          ...view,
          pullRequests: [],
          commits: [],
          branches: [{ id: "x", repo, name: "evil", url: "javascript:alert(1)" }],
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("evil")).toBeInTheDocument();
  });
});
