// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";

import { RichTextEditor } from "./rich-text-editor";

const initial: RichTextDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "See STK-4" }] }],
};

describe("RichTextEditor", () => {
  it("loads JSON content, highlights STK refs and labels its controls", async () => {
    render(
      <RichTextEditor
        initialContent={initial}
        onChange={() => {}}
        projectKeys={["STK"]}
        label="Description"
      />,
    );
    const box = await screen.findByRole("textbox", { name: "Description" });
    expect(box).toHaveTextContent("See STK-4");
    await waitFor(() => expect(box.querySelector(".issue-ref-chip")).toHaveTextContent("STK-4"));
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "false");
  });

  it("submits on Mod+Enter and cancels on Escape", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <RichTextEditor
        initialContent={null}
        onChange={() => {}}
        onSubmit={onSubmit}
        onCancel={onCancel}
        projectKeys={["STK"]}
        label="Comment"
      />,
    );
    const box = await screen.findByRole("textbox", { name: "Comment" });
    // jsdom has no layout, so typing is not simulated; key handling is.
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
