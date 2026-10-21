import { type MentionNodeAttrs } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";

import { type MentionUser } from "@/lib/notifications/views";

import { MentionList, type MentionListHandle, type MentionListProps } from "./mention-list";
import { cachedMentionUsers, filterMentionUsers, type LoadMentionUsers } from "./mention-users";

/**
 * The "@" suggestion of the mention node (client-only). `@tiptap/suggestion` finds the
 * query and forwards keys; the popup is our `MentionList`, mounted by the plugin's
 * Floating UI loop at the caret (absolutely positioned, so the page never shifts) and
 * repositioned on scroll and resize.
 */

let popupCount = 0;

type Props = SuggestionProps<MentionUser, MentionNodeAttrs>;

export function userMentionSuggestion(
  loadUsers: LoadMentionUsers,
): Omit<SuggestionOptions<MentionUser, MentionNodeAttrs>, "editor"> {
  return {
    char: "@",
    items: async ({ query }) => filterMentionUsers(await cachedMentionUsers(loadUsers), query),
    render: () => {
      let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      let unmount: (() => void) | null = null;
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
          // Inside a modal dialog (quick create) the popup must sit in the dialog: outside it
          // the dialog makes everything inert to the pointer.
          const host = props.editor.view.dom.closest('[role="dialog"]') ?? document.body;
          host.appendChild(element);
          unmount = props.mount(element);
        },
        onUpdate(props) {
          renderer?.updateProps(listProps(props));
        },
        onKeyDown({ event }) {
          // Esc is handled by the plugin (it closes the list).
          if (event.key === "Escape") return true;
          return renderer?.ref?.onKeyDown(event) ?? false;
        },
        onExit() {
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
