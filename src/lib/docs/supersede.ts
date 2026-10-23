import { emptyDoc, extractPlainText, type RichTextDoc, type RichTextNode } from "@/lib/rich-text";

import { formatAdrNumber } from "./adr";

/**
 * ADR-3 "Supersede with new ADR": the new ADR's Context starts with the bullet
 * `Supersedes: [NNNN](NNNN-slug.md)` (the handbook's style, a link to the old ADR's file
 * relative to the new one's). Isomorphic and pure.
 */

const SUPERSEDES_PREFIX = /^\s*supersedes\s*:/i;

function supersedesItem(number: number, href: string): RichTextNode {
  return {
    type: "listItem",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Supersedes: " },
          {
            type: "text",
            text: formatAdrNumber(number),
            marks: [{ type: "link", attrs: { href } }],
          },
        ],
      },
    ],
  };
}

const isContextHeading = (node: RichTextNode) =>
  node.type === "heading" && extractPlainText(node).trim().toLowerCase() === "context";

/**
 * The template with the Supersedes bullet: it replaces the template's own "Supersedes: …"
 * placeholder bullet in the Context list, or goes first in that list, or (no list) right
 * under the Context heading, or (no Context section) into a new one at the top.
 */
export function withSupersedesBullet(
  template: RichTextDoc | null,
  old: { number: number; href: string },
): RichTextDoc {
  const blocks = [...((template ?? emptyDoc()).content ?? [])];
  const item = supersedesItem(old.number, old.href);
  const heading = blocks.findIndex(isContextHeading);
  if (heading < 0) {
    return {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Context" }] },
        { type: "bulletList", content: [item] },
        ...blocks,
      ],
    };
  }
  const list = blocks[heading + 1];
  if (list?.type !== "bulletList") {
    blocks.splice(heading + 1, 0, { type: "bulletList", content: [item] });
    return { type: "doc", content: blocks };
  }
  const items = list.content ?? [];
  const placeholder = items.findIndex((entry) => SUPERSEDES_PREFIX.test(extractPlainText(entry)));
  const nextItems =
    placeholder >= 0
      ? items.map((entry, index) => (index === placeholder ? item : entry))
      : [item, ...items];
  blocks[heading + 1] = { ...list, content: nextItems };
  return { type: "doc", content: blocks };
}
