// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { lineDiff } from "@/lib/text/line-diff";

import { diffSummary, VersionDiff } from "./version-diff";

const lines = (count: number, prefix = "same") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");

describe("VersionDiff (DOC-10)", () => {
  it("marks added and removed lines with +/− and a label, not colour only", () => {
    render(
      <VersionDiff
        oldText={"# Title\n\nold line\nkept"}
        newText={"# Title\n\nnew line\nkept"}
        oldLabel="v1"
        newLabel="v2"
      />,
    );
    const list = screen.getByRole("list", { name: "Changes from v1 to v2" });
    const rows = within(list).getAllByRole("listitem");
    const removed = rows.find((row) => row.dataset.kind === "remove");
    const added = rows.find((row) => row.dataset.kind === "add");
    expect(removed).toHaveTextContent("−Removed: old line");
    expect(added).toHaveTextContent("+Added: new line");
    // Unchanged lines have no label and a blank marker.
    const kept = rows.find((row) => row.textContent?.includes("kept"));
    expect(kept?.dataset.kind).toBe("equal");
    expect(screen.getByText(/added,/)).toHaveTextContent("v1 → v2: +1 added, −1 removed lines");
  });

  it("collapses long unchanged runs behind a button that shows them", async () => {
    const user = userEvent.setup();
    const oldText = `${lines(20)}\nold`;
    const newText = `${lines(20)}\nnew`;
    render(<VersionDiff oldText={oldText} newText={newText} oldLabel="v1" newLabel="v2" />);
    expect(screen.queryByText("same 1")).not.toBeInTheDocument();
    // Three lines of context stay visible next to the change.
    expect(screen.getByText("same 18")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 17 unchanged lines" }));
    expect(screen.getByText("same 1")).toBeInTheDocument();
  });

  it("says so when there is no difference, and counts changes", () => {
    render(<VersionDiff oldText="a" newText="a" oldLabel="v3" newLabel="the current version" />);
    expect(screen.getByText("No differences between v3 and the current version.")).toBeVisible();
    expect(diffSummary(lineDiff("a\nb\nc", "a\nx\ny\nc"))).toEqual({ added: 2, removed: 1 });
  });
});
