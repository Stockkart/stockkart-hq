"use client";

import { usePathname, useRouter } from "next/navigation";
import { useId } from "react";

import { Select } from "@/components/ui/select";
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
      <Select
        id={id}
        label="Group by"
        className="w-32"
        align="end"
        value={group}
        options={BACKLOG_GROUPS.map((value) => ({ value, label: LABELS[value] }))}
        onChange={(next) => {
          const value = next ?? "none";
          const query = filtersToSearchParams(filters, {
            group: value === "none" ? undefined : value,
          }).toString();
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }}
      />
    </div>
  );
}
