// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type ReleaseSummary } from "@/lib/releases/views";

import { DeleteReleaseDialog, MarkReleasedDialog, ReleaseFormDialog } from "./release-dialogs";

function release(id: string, overrides: Partial<ReleaseSummary> = {}): ReleaseSummary {
  return {
    id,
    name: id,
    description: null,
    releaseDate: null,
    state: "unreleased",
    releasedAt: null,
    total: { count: 0, points: 0 },
    done: { count: 0, points: 0 },
    notesDocId: null,
    ...overrides,
  };
}

const withOpen = release("api-v1.4", {
  total: { count: 3, points: 8 },
  done: { count: 1, points: 3 },
});

describe("release dialogs (REL-1)", () => {
  it("warns about open issues and moves them to the picked release", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <MarkReleasedDialog
        open
        onOpenChange={() => {}}
        release={withOpen}
        targets={[release("api-v1.5"), release("api-v1.6")]}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText("2 issues are not done yet.")).toBeInTheDocument();
    // The first choice (move) has the focus; pick the target with the keyboard.
    expect(screen.getByRole("radio", { name: /Move them/ })).toHaveFocus();
    const target = screen.getByRole("combobox", { name: "Target release" });
    expect(target).toHaveTextContent("api-v1.5");
    await user.click(target);
    await user.click(screen.getByRole("option", { name: "api-v1.6" }));
    await user.click(screen.getByRole("button", { name: "Mark released" }));
    expect(onConfirm).toHaveBeenCalledWith({ action: "move", targetReleaseId: "api-v1.6" });
  });

  it("releases anyway when chosen, and without a question when all is done", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <MarkReleasedDialog
        open
        onOpenChange={() => {}}
        release={withOpen}
        targets={[]}
        onConfirm={onConfirm}
      />,
    );
    // No other unreleased release: moving is not possible, "release anyway" is preselected.
    expect(screen.getByRole("radio", { name: /Move them/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Release anyway/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Mark released" }));
    expect(onConfirm).toHaveBeenLastCalledWith({ action: "keep" });

    rerender(
      <MarkReleasedDialog
        open
        onOpenChange={() => {}}
        release={release("done", { total: { count: 2, points: 0 }, done: { count: 2, points: 0 } })}
        targets={[]}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Mark released" }));
    expect(onConfirm).toHaveBeenLastCalledWith(undefined);
  });

  it("starts from the current targets each time it opens", async () => {
    const props = { onOpenChange: () => {}, release: withOpen, onConfirm: vi.fn() };
    const { rerender } = render(<MarkReleasedDialog open {...props} targets={[]} />);
    expect(screen.getByRole("radio", { name: /Release anyway/ })).toBeChecked();
    rerender(<MarkReleasedDialog open={false} {...props} targets={[]} />);
    rerender(<MarkReleasedDialog open {...props} targets={[release("api-v1.7")]} />);
    expect(await screen.findByRole("radio", { name: /Move them/ })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Target release" })).toHaveTextContent("api-v1.7");
  });

  it("offers to unset the fix version before deleting a release with issues", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <DeleteReleaseDialog open onOpenChange={() => {}} release={withOpen} onConfirm={onConfirm} />,
    );
    // The safe choice has the focus.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Unset on 3 issues and delete" }));
    expect(onConfirm).toHaveBeenLastCalledWith(true);

    rerender(
      <DeleteReleaseDialog
        open
        onOpenChange={() => {}}
        release={release("empty")}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete release" }));
    expect(onConfirm).toHaveBeenLastCalledWith(false);
  });

  it("validates the form and normalises empty fields to null", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ReleaseFormDialog
        open
        onOpenChange={() => {}}
        mode="create"
        initial={{ name: "", releaseDate: null, description: null }}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create release" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(onConfirm).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Name"), "  api-v2{Enter}");
    expect(onConfirm).toHaveBeenCalledWith({
      name: "api-v2",
      releaseDate: null,
      description: null,
    });
  });
});
