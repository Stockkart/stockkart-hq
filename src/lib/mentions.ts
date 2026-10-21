import { type RichTextNode } from "@/lib/rich-text";

/**
 * @mentions of people (ISS-7, DOC-9, NTF-1). The editor stores a mention as an inline atom
 * `{ type: "mention", attrs: { id: <users.id>, label: <name> } }` (Tiptap's Mention shape);
 * the server derives `entity_links` rows with `to_type = 'user'` from it
 * (`userMentionSyncCtes` in server/services/sql.ts). Isomorphic.
 */

export const USER_MENTION_NODE = "mention";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unique, lower-cased user ids of every mention node, in order of first appearance. */
export function extractUserMentionIds(doc: RichTextNode | null | undefined): string[] {
  if (!doc) return [];
  const seen = new Set<string>();
  // Iterative, like the rich-text limit check, so a deep document cannot overflow the stack.
  const stack: RichTextNode[] = [doc];
  const ordered: RichTextNode[] = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    ordered.push(node);
    const children = node.content ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push(child);
    }
  }
  for (const node of ordered) {
    if (node.type !== USER_MENTION_NODE) continue;
    const id = node.attrs?.id;
    // The id comes from client JSON: only well-formed uuids are kept; the SQL then keeps
    // only ids of existing users.
    if (typeof id === "string" && UUID_PATTERN.test(id)) seen.add(id.toLowerCase());
  }
  return [...seen];
}
