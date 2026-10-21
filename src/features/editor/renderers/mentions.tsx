import { mentionLabel } from "@/lib/rich-text-nodes/mentions";

import { type NodeRenderers } from "./types";

/** The chip look of an @mention, shared by the editor's node and the read-only view. */
export const MENTION_CHIP_CLASS =
  "mention inline-flex items-baseline rounded bg-primary/10 px-1 font-medium text-primary";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @user mentions (ISS-7, DOC-9) in the read-only view: "@Name" as a chip. */
export const mentionRenderers: NodeRenderers = {
  mention: ({ node, index }) => {
    const id = node.attrs?.id;
    return (
      <span
        key={index}
        data-type="mention"
        // Only a well-formed id reaches the DOM (the JSON comes from the client).
        data-id={typeof id === "string" && UUID_PATTERN.test(id) ? id : undefined}
        className={MENTION_CHIP_CLASS}
      >
        @{mentionLabel(node) ?? "someone"}
      </span>
    );
  },
};
