// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { anchorIdsInOrder, COMMENT_ANCHOR_MARK } from "@/lib/doc-comments/anchors";
import { richTextDocSchema, type RichTextDoc } from "@/lib/rich-text";

import {
  COMMENT_REQUEST_EVENT,
  type CommentRequestDetail,
  isCommentRequestEvent,
} from "./comment-anchor-events";
import { CommentAnchor } from "./comment-anchor-mark";
import { RichTextEditor } from "./rich-text-editor";

const content: RichTextDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello brave new world" }] }],
};

const editors: Editor[] = [];
function editorWith(initial: RichTextDoc = content): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, CommentAnchor], content: initial });
  editors.push(editor);
  return editor;
}

/** Selects "brave new" (positions 7–16 in the paragraph). */
function selectBraveNew(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 16)));
}

/** Accepts comment requests like the doc page's panel does. */
function acceptRequests() {
  const requests: CommentRequestDetail[] = [];
  const listener = (event: Event) => {
    if (!isCommentRequestEvent(event)) return;
    event.preventDefault();
    requests.push(event.detail);
  };
  document.addEventListener(COMMENT_REQUEST_EVENT, listener);
  return { requests, stop: () => document.removeEventListener(COMMENT_REQUEST_EVENT, listener) };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

describe("commentAnchor mark (DOC-13)", () => {
  it("wraps the selection in a mark with a new anchor id once the page accepts", () => {
    const editor = editorWith();
    selectBraveNew(editor);
    const { requests, stop } = acceptRequests();
    expect(editor.commands.startComment()).toBe(true);
    stop();
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.text).toBe("brave new");
    expect(request?.anchorId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const json = richTextDocSchema.parse(editor.getJSON());
    expect(anchorIdsInOrder(json)).toEqual([request?.anchorId]);
    expect(editor.view.dom.querySelector("[data-comment-anchor]")?.textContent).toBe("brave new");
  });

  it("adds nothing when no page accepts, or when nothing is selected", () => {
    const editor = editorWith();
    selectBraveNew(editor);
    expect(editor.commands.startComment()).toBe(false);
    const { requests, stop } = acceptRequests();
    editor.commands.setTextSelection(3);
    expect(editor.commands.startComment()).toBe(false);
    stop();
    expect(requests).toHaveLength(0);
    expect(anchorIdsInOrder(richTextDocSchema.parse(editor.getJSON()))).toEqual([]);
  });

  it("does not ask inside a code block, where the mark cannot go (no instant orphan)", () => {
    const editor = editorWith({
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: "const x = 1" }] }],
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    );
    const { requests, stop } = acceptRequests();
    expect(editor.commands.startComment()).toBe(false);
    stop();
    expect(requests).toHaveLength(0);
  });

  it("answers ⌘/Ctrl+Alt+M", () => {
    const editor = editorWith();
    selectBraveNew(editor);
    const { requests, stop } = acceptRequests();
    fireEvent.keyDown(editor.view.dom, { key: "m", code: "KeyM", ctrlKey: true, altKey: true });
    stop();
    expect(requests).toHaveLength(1);
  });

  it("discard() removes exactly that anchor's mark", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "kept",
              marks: [{ type: COMMENT_ANCHOR_MARK, attrs: { anchorId: "keepMe" } }],
            },
            { type: "text", text: " and brave new" },
          ],
        },
      ],
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 10, 19)),
    );
    const { requests, stop } = acceptRequests();
    editor.commands.startComment();
    stop();
    expect(anchorIdsInOrder(richTextDocSchema.parse(editor.getJSON()))).toHaveLength(2);
    requests[0]?.discard();
    expect(anchorIdsInOrder(richTextDocSchema.parse(editor.getJSON()))).toEqual(["keepMe"]);
  });

  it("keeps stored marks through load and save, overlapping ones included", () => {
    const stored: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "both",
              marks: [
                { type: COMMENT_ANCHOR_MARK, attrs: { anchorId: "first" } },
                { type: COMMENT_ANCHOR_MARK, attrs: { anchorId: "second" } },
              ],
            },
            { type: "text", text: " plain" },
          ],
        },
      ],
    };
    const editor = editorWith(stored);
    expect(richTextDocSchema.parse(editor.getJSON())).toEqual(stored);
  });

  it("is not inclusive: typing at the end of an anchor does not extend it", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "quoted",
              marks: [{ type: COMMENT_ANCHOR_MARK, attrs: { anchorId: "abc" } }],
            },
          ],
        },
      ],
    });
    editor.commands.setTextSelection(7);
    editor.commands.insertContent("!");
    expect(editor.view.dom.querySelector("[data-comment-anchor]")?.textContent).toBe("quoted");
  });

  it("puts a keyboard-reachable Comment button right after the editing area", () => {
    const editor = editorWith();
    const button = editor.view.dom.nextElementSibling;
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.getAttribute("aria-label")).toMatch(/^Comment on the selected text/);
    expect(button).toHaveProperty("hidden", true);
  });
});

describe("the doc editor's toolbar (DOC-13)", () => {
  it("has a Comment button that needs a selection", async () => {
    render(
      <RichTextEditor
        initialContent={content}
        onChange={() => {}}
        projectKeys={[]}
        label="Document"
        variant="doc"
      />,
    );
    await screen.findByRole("textbox", { name: "Document" });
    const button = screen.getByRole("button", { name: /^Comment on selection/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});
