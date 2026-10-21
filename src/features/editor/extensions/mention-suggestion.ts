import { type MentionNodeAttrs } from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { exitSuggestion, type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";

import { type MentionUser } from "@/lib/notifications/views";

import { MentionList, type MentionListHandle, type MentionListProps } from "./mention-list";
import { cachedMentionUsers, filterMentionUsers, type LoadMentionUsers } from "./mention-users";

/**
 * The "@" suggestion of the mention node (client-only). `@tiptap/suggestion` finds the
 * query and forwards keys; the popup is our `MentionList`, mounted by the plugin's
 * Floating UI loop at the caret (absolutely positioned, so the page never shifts) and
 * repositioned on scroll and resize.
 */

/** The suggestion plugin's key (one plugin state per editor). */
export const USER_MENTION_SUGGESTION_KEY = new PluginKey("userMentionSuggestion");

let popupCount = 0;

type Props = SuggestionProps<MentionUser, MentionNodeAttrs>;

export function userMentionSuggestion(
  loadUsers: LoadMentionUsers,
): Omit<SuggestionOptions<MentionUser, MentionNodeAttrs>, "editor"> {
  return {
    char: "@",
    pluginKey: USER_MENTION_SUGGESTION_KEY,
    items: async ({ query }) => filterMentionUsers(await cachedMentionUsers(loadUsers), query),
    render: () => {
      let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      let unmount: (() => void) | null = null;
      let stopEscape: (() => void) | null = null;
      popupCount += 1;
      const listboxId = `mention-listbox-${popupCount}`;

      const listProps = (props: Props): MentionListProps => ({
        items: props.items,
        loading: props.loading,
        listboxId,
        editorDom: props.editor.view.dom,
        onSelect: (user) => props.command({ id: user.id, label: user.name }),
      });

      return {
        onStart(props) {
          renderer = new ReactRenderer(MentionList, {
            props: listProps(props),
            editor: props.editor,
          });
          const element = renderer.element;
          element.style.zIndex = "60";
          const view = props.editor.view;
          // Inside a modal dialog (quick create) the popup must sit in the dialog: outside it
          // the dialog makes everything inert to the pointer.
          const host = view.dom.closest('[role="dialog"]') ?? document.body;
          host.appendChild(element);
          unmount = props.mount(element);
          // Esc closes only the list. A surrounding dialog listens for Esc on the document in
          // the capture phase, before the editor sees the key, so take it first (window
          // capture) and close the list here.
          const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || !(event.target instanceof Node)) return;
            if (!view.dom.contains(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            exitSuggestion(view, USER_MENTION_SUGGESTION_KEY);
          };
          window.addEventListener("keydown", onEscape, true);
          stopEscape = () => window.removeEventListener("keydown", onEscape, true);
        },
        onUpdate(props) {
          renderer?.updateProps(listProps(props));
        },
        onKeyDown({ event }) {
          // Esc is handled above (and by the plugin, which closes the list).
          if (event.key === "Escape") return true;
          return renderer?.ref?.onKeyDown(event) ?? false;
        },
        onExit() {
          stopEscape?.();
          stopEscape = null;
          unmount?.();
          unmount = null;
          renderer?.element.remove();
          renderer?.destroy();
          renderer = null;
        },
      };
    },
  };
}
