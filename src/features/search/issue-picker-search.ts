"use client";

import { type SelectOption } from "@/components/ui/select";
import { SEARCH_QUERY_MAX } from "@/lib/search/schemas";
import { searchAction } from "@/server/actions/search";

/**
 * `Combobox` options for "pick an issue" (links, linked issues): the ⌘K search (SRCH-1),
 * an exact key first. The value is the issue key, which is what the link actions take.
 * Nothing is sent for an empty query.
 */
export async function searchIssueOptions(
  query: string,
  { exclude = [] }: { exclude?: readonly string[] } = {},
): Promise<SelectOption<string>[]> {
  const q = query.trim().slice(0, SEARCH_QUERY_MAX);
  if (!q) return [];
  const result = await searchAction({ q });
  if (!result.ok) throw new Error(result.error);
  const { jump, issues } = result.data;
  const options = new Map<string, SelectOption<string>>();
  if (jump) options.set(jump.key, { value: jump.key, label: `${jump.key} ${jump.title}` });
  for (const hit of issues) {
    // Issue hits link to `/<PROJECT>/issues/<KEY>`; the title starts with the key.
    const key = decodeURIComponent(hit.href.split("/").pop() ?? "");
    if (key && !options.has(key)) options.set(key, { value: key, label: hit.title });
  }
  return [...options.values()].filter((option) => !exclude.includes(option.value));
}
