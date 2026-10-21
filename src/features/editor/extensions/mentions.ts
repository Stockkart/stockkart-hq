import { Mention } from "@tiptap/extension-mention";

import { listMentionUsersAction } from "@/server/actions/watchers";

import { MENTION_CHIP_CLASS } from "../renderers/mentions";

import { userMentionSuggestion } from "./mention-suggestion";
import { type LoadMentionUsers } from "./mention-users";
import { type EditorFeature } from "./types";

/**
 * @user mentions (ISS-7, DOC-9, NTF-1) in every editor: "@" opens a list of HQ users that
 * filters as you type. The node stores `{ id: <users.id>, label: <name> }`
 * (`lib/mentions.ts`); the server links and notifies the newly mentioned users on save.
 */

/** Loads the users through the server action; a failure shows an empty list. */
const loadUsers: LoadMentionUsers = async () => {
  const result = await listMentionUsersAction();
  return result.ok ? result.data : [];
};

export function createMentionFeature(load: LoadMentionUsers = loadUsers): EditorFeature {
  return {
    name: "mention",
    variants: ["issue", "comment", "doc"],
    extensions: () => [
      Mention.configure({
        HTMLAttributes: { class: MENTION_CHIP_CLASS },
        // Backspace after a mention removes it whole, the "@" included.
        deleteTriggerWithBackspace: true,
        suggestion: userMentionSuggestion(load),
      }),
    ],
  };
}

export const mentionFeature: EditorFeature = createMentionFeature();
