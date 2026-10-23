import { type Editor, Mark, mergeAttributes } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { type EditorView } from "@tiptap/pm/view";

import {
  anchorQuote,
  COMMENT_ANCHOR_MARK,
  isAnchorId,
  newAnchorId,
} from "@/lib/doc-comments/anchors";

import {
  COMMENT_ANCHOR_ATTRIBUTE,
  COMMENT_REQUEST_EVENT,
  COMMENT_SHORTCUT,
  COMMENT_SHORTCUT_LABEL,
  type CommentRequestDetail,
} from "./comment-anchor-events";

/**
 * DOC-13 inline comment anchor: a mark `{ type: "commentAnchor", attrs: { anchorId } }` on
 * the commented text. It renders as `<span data-comment-anchor="…" class="comment-anchor">`
 * with no styling of its own; the comments panel highlights the anchors of OPEN threads
 * (resolved ones stay plain), so the mark never needs to know a thread's state.
 *
 * - not inclusive: typing at either edge does not extend the anchor;
 * - `excludes: ""`: overlapping selections keep one mark per thread;
 * - kept through autosave and the conflict path like any other mark (it is plain JSON).
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentAnchor: {
      /** Asks the page to comment on the selection; marks it if the page accepts. */
      startComment: () => ReturnType;
      /** Removes every mark with this anchor id (e.g. the comment was not created). */
      removeCommentAnchor: (anchorId: string) => ReturnType;
    };
  }
}

/**
 * The quote for the current selection, or "" when nothing commentable is selected: empty,
 * only whitespace, or only text where the mark is not allowed (e.g. inside a code block,
 * which would make an instantly orphaned thread).
 */
export function selectionQuote(state: EditorState): string {
  const { from, to, empty } = state.selection;
  const type = state.schema.marks[COMMENT_ANCHOR_MARK];
  if (empty || !type) return "";
  let markable = false;
  state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (node.isText && parent?.type.allowsMarkType(type)) markable = true;
    return !markable;
  });
  if (!markable) return "";
  return anchorQuote(state.doc.textBetween(from, to, " ", " "));
}

/**
 * Dispatches the comment request for the current selection. Returns the new anchor id if a
 * listener accepted it (preventDefault), else null; the caller then adds the mark.
 */
function dispatchCommentRequest(editor: Editor): string | null {
  if (!editor.isEditable) return null;
  const text = selectionQuote(editor.state);
  if (!text) return null;
  const anchorId = newAnchorId();
  const detail: CommentRequestDetail = {
    anchorId,
    text,
    discard: () => {
      if (!editor.isDestroyed) editor.commands.removeCommentAnchor(anchorId);
    },
    restoreFocus: () => {
      if (!editor.isDestroyed) editor.commands.focus();
    },
  };
  const event = new CustomEvent(COMMENT_REQUEST_EVENT, {
    bubbles: true,
    cancelable: true,
    detail,
  });
  const accepted = !editor.view.dom.dispatchEvent(event);
  return accepted ? anchorId : null;
}

/**
 * Asks the page to comment on the selection; only if a listener accepts it is the selection
 * wrapped in a new anchor mark. Returns whether it was accepted.
 */
export function requestComment(editor: Editor): boolean {
  return editor.commands.startComment();
}

const BUTTON_LABEL = `Comment on the selected text (${COMMENT_SHORTCUT_LABEL})`;

/**
 * The floating "Comment" button next to a non-empty selection. It is a real button placed
 * right after the editing area in the DOM, so Tab from the selection reaches it; it keeps
 * the selection on mousedown and hides once focus leaves both the editor and the button.
 */
class FloatingCommentButton {
  private readonly button: HTMLButtonElement;
  private readonly onFocusOut = () => {
    // After the focus moved: still in the editor or on the button means stay visible.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== this.button && !this.view.dom.contains(active)) this.hide();
    });
  };
  private readonly onFocusIn = () => this.update(this.view);

  constructor(
    private readonly view: EditorView,
    private readonly editor: Editor,
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Comment";
    button.setAttribute("aria-label", BUTTON_LABEL);
    button.title = BUTTON_LABEL;
    button.className = "comment-anchor-button";
    button.hidden = true;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (requestComment(this.editor)) this.hide();
    });
    button.addEventListener("focusout", this.onFocusOut);
    this.button = button;
    const parent = view.dom.parentElement;
    if (parent) {
      // The button is positioned relative to the editor's wrapper.
      parent.style.position = "relative";
      parent.insertBefore(button, view.dom.nextSibling);
    }
    view.dom.addEventListener("focusout", this.onFocusOut);
    view.dom.addEventListener("focusin", this.onFocusIn);
  }

  update(view: EditorView) {
    const parent = this.button.parentElement;
    if (!parent || !this.editor.isEditable || !selectionQuote(view.state)) {
      this.hide();
      return;
    }
    if (!view.hasFocus() && document.activeElement !== this.button) return;
    try {
      const end = view.coordsAtPos(view.state.selection.to);
      const box = parent.getBoundingClientRect();
      this.button.style.top = `${end.bottom - box.top + 4}px`;
      this.button.style.left = `${Math.max(0, end.left - box.left - 32)}px`;
    } catch {
      // No layout (e.g. jsdom): keep the last position.
    }
    this.button.hidden = false;
  }

  hide() {
    this.button.hidden = true;
  }

  destroy() {
    this.view.dom.removeEventListener("focusout", this.onFocusOut);
    this.view.dom.removeEventListener("focusin", this.onFocusIn);
    this.button.remove();
  }
}

const floatingButtonKey = new PluginKey("commentAnchorButton");

export const CommentAnchor = Mark.create({
  name: COMMENT_ANCHOR_MARK,
  inclusive: false,
  excludes: "",
  spanning: true,

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute(COMMENT_ANCHOR_ATTRIBUTE);
          return isAnchorId(value) ? value : null;
        },
        // Only a well-formed id reaches the DOM (it is used in CSS selectors by the panel).
        renderHTML: (attributes) =>
          isAnchorId(attributes.anchorId)
            ? { [COMMENT_ANCHOR_ATTRIBUTE]: attributes.anchorId }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[${COMMENT_ANCHOR_ATTRIBUTE}]`,
        getAttrs: (element) =>
          isAnchorId(element.getAttribute(COMMENT_ANCHOR_ATTRIBUTE)) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "comment-anchor" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      startComment:
        () =>
        ({ editor, tr, dispatch }) => {
          const type = editor.schema.marks[this.name];
          // A dry run (`can()`) only asks whether there is something to comment on.
          if (!dispatch) return Boolean(type) && selectionQuote(editor.state) !== "";
          if (!type) return false;
          const anchorId = dispatchCommentRequest(editor);
          if (!anchorId) return false;
          const { from, to } = tr.selection;
          tr.addMark(from, to, type.create({ anchorId }));
          return true;
        },
      removeCommentAnchor:
        (anchorId) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks[this.name];
          if (!type) return false;
          let found = false;
          state.doc.descendants((node, pos) => {
            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.anchorId === anchorId) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                found = true;
              }
            }
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      [COMMENT_SHORTCUT]: () => this.editor.commands.startComment(),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: floatingButtonKey,
        view: (view) => new FloatingCommentButton(view, editor),
      }),
    ];
  },
});
