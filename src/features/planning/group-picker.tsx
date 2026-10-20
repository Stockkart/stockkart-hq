"use client";

import { usePathname, useRouter } from "next/navigation";
import { useId } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import {
  BACKLOG_GROUPS,
  type BacklogGroup,
  filtersToSearchParams,
  type IssueFilters,
} from "@/lib/issues/filters";

const LABELS: Record<BacklogGroup, string> = {
  none: "None",
  epic: "Epic",
  component: "Component",
  assignee: "Assignee",
};

/** BLG-2 "Group by", kept in the URL (`?group=epic`) next to the filters. */
export function GroupPicker({ group, filters }: { group: BacklogGroup; filters: IssueFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        Group by
      </label>
      <NativeSelect
        id={id}
        className="w-32"
        value={group}
        onChange={(event) => {
          const next = BACKLOG_GROUPS.find((value) => value === event.target.value) ?? "none";
          const query = filtersToSearchParams(filters, {
            group: next === "none" ? undefined : next,
          }).toString();
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }}
      >
        {BACKLOG_GROUPS.map((value) => (
          <option key={value} value={value}>
            {LABELS[value]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
