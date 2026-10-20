/**
 * Page-tree helpers (DOC-2), shared by the tree UI and the doc service. Isomorphic.
 *
 * `position` holds `fractional-indexing` keys, which sort by plain code-unit comparison
 * (the column uses COLLATE "C" for the same reason). Equal keys are possible (two creates at
 * the same moment), so ties fall back to the id, as the SQL `ORDER BY position, id` does.
 */

export interface TreeDoc {
  id: string;
  parentId: string | null;
  position: string;
}

export type TreeNode<T extends TreeDoc> = T & { children: TreeNode<T>[] };

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function compareSiblings(a: TreeDoc, b: TreeDoc): number {
  return codeUnitCompare(a.position, b.position) || codeUnitCompare(a.id, b.id);
}

/** Nested tree. A doc whose parent is not in `docs` (deleted, say) shows at the top level. */
export function buildTree<T extends TreeDoc>(docs: readonly T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>(docs.map((doc) => [doc.id, { ...doc, children: [] }]));
  const roots: TreeNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: TreeNode<T>[]) => {
    list.sort(compareSiblings);
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/** Ids of every doc below `id` (not including `id`). Iterative, so cycles cannot hang it. */
export function descendantIds(docs: readonly TreeDoc[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const doc of docs) {
    if (!doc.parentId) continue;
    const list = childrenOf.get(doc.parentId) ?? [];
    list.push(doc.id);
    childrenOf.set(doc.parentId, list);
  }
  const found = new Set<string>();
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || found.has(next)) continue;
    found.add(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }
  return found;
}

/** Siblings under `parentId` in display order, leaving out `excludeId` (the doc being moved). */
export function siblingsOf<T extends TreeDoc>(
  docs: readonly T[],
  parentId: string | null,
  excludeId?: string,
): T[] {
  const known = new Set(docs.map((doc) => doc.id));
  return docs
    .filter((doc) => {
      if (doc.id === excludeId) return false;
      // Orphans (parent not in the list) sit at the top level, as in `buildTree`.
      const effectiveParent = doc.parentId && known.has(doc.parentId) ? doc.parentId : null;
      return effectiveParent === parentId;
    })
    .sort(compareSiblings);
}

/** Depth-first list with depth, e.g. for a "Move to…" parent picker. */
export function flattenTree<T extends TreeDoc>(
  roots: readonly TreeNode<T>[],
): { node: TreeNode<T>; depth: number }[] {
  const out: { node: TreeNode<T>; depth: number }[] = [];
  const walk = (list: readonly TreeNode<T>[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}
