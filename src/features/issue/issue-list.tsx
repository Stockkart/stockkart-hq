"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";

import { MultiSelect } from "@/components/ui/select";
import { applyBulkChange } from "@/features/bulk/apply";
import { BulkBar, type BulkOptions } from "@/features/bulk/bulk-bar";
import { RowCheckbox, SelectAllCheckbox } from "@/features/bulk/checkboxes";
import { selectRowProps, useRowSelection, useSelectShortcut } from "@/features/bulk/use-selection";
import { NAV_ITEM, NAV_LINK, useListNavigation } from "@/features/planning/use-list-navigation";
import { type BulkChange } from "@/lib/issues/bulk";
import {
  hasActiveFilters,
  type IssueFilters,
  type IssueSort,
  type IssueSortKey,
} from "@/lib/issues/filters";
import { type PlanningIssue } from "@/lib/issues/views";
import { cn } from "@/lib/utils";
import { type ListDefaultsContext, listFiltersQuery } from "@/lib/views/view-defaults";
import { bulkEditIssuesAction } from "@/server/actions/bulk";

import { callAction, RelativeTime } from "./client-utils";
import { Avatar, IssueTypeIcon, PriorityLabel, StatusBadge } from "./issue-badges";
import { useOptionalColumns } from "./optional-columns";

interface IssueListProps {
  issues: PlanningIssue[];
  projectKey: string;
  filters: IssueFilters;
  sort: IssueSort;
  /** ISS-12 bulk bar pickers (the page's project options). */
  bulkOptions: BulkOptions;
  /** VW-3: the open saved view, kept in the sort links. */
  viewId?: string;
  /** VW-4: the list defaults, so sort links leave them out of the URL like the filter bar. */
  listDefaults?: ListDefaultsContext;
}

interface BulkUpdate {
  ids: ReadonlySet<string>;
  change: BulkChange;
}

const COLUMNS: { key: IssueSortKey; label: string; className: string; srOnly?: boolean }[] = [
  { key: "key", label: "Key", className: "w-24 px-3" },
  { key: "type", label: "Type", className: "w-12 px-1", srOnly: true },
  { key: "title", label: "Title", className: "px-3" },
  { key: "status", label: "Status", className: "w-36 px-3" },
  { key: "priority", label: "Priority", className: "w-24 px-3" },
  { key: "assignee", label: "Assignee", className: "w-44 px-3" },
  { key: "points", label: "Points", className: "w-20 px-3 text-right" },
  { key: "updated", label: "Updated", className: "w-32 px-3" },
];

/** Columns that read best largest/newest first on the first click. */
const DESC_FIRST = new Set<IssueSortKey>(["updated", "created", "points"]);

/**
 * VW-1 issue list: sortable columns (sort lives in the URL next to the filters, VW-2) and
 * J/K row selection (SPEC §9.5).
 *
 * ISS-12 bulk edit: row checkboxes (shift-click for a range, `x` on the focused row, the
 * header box for all visible rows) and the bulk bar. A bulk change shows at once
 * (`useOptimistic`); the action re-renders the page with the server's state in the same
 * transition, and a failed action ends it without new data: the rollback.
 */
export function IssueList({
  issues,
  projectKey,
  filters,
  sort,
  bulkOptions,
  viewId,
  listDefaults,
}: IssueListProps) {
  const container = useRef<HTMLDivElement>(null);
  useListNavigation(container);
  const [shown, applyBulk] = useOptimistic(issues, (state, update: BulkUpdate) =>
    applyBulkChange(state, update.ids, update.change, bulkOptions),
  );
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const selection = useRowSelection(shown.map((issue) => issue.id));
  useSelectShortcut(container, (id) => selection.toggle(id));
  // REL-1: the optional "Fix version" column (only where the page passes the releases).
  const releases = bulkOptions.releases;
  const columns = useOptionalColumns();
  const showRelease = releases !== undefined && columns.shown.includes("release");
  const releaseNames = new Map((releases ?? []).map((release) => [release.id, release.name]));

  function runBulk(change: BulkChange, description: string) {
    const ids = selection.selectedIds;
    startTransition(async () => {
      applyBulk({ ids: new Set(ids), change });
      const result = await callAction(() =>
        bulkEditIssuesAction({ projectKey, issueIds: ids, change }),
      );
      setAnnouncement(result ? description : "The bulk edit was not saved");
      if (result && change.kind === "delete") selection.clear();
    });
  }

  // Outside the early return, so "Deleted 3 issues" is still announced when none are left.
  const live = (
    <p aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (shown.length === 0) {
    const empty = hasActiveFilters(filters) ? (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="font-medium">No issues match these filters</h2>
        <p className="mt-1 text-sm text-muted-foreground">Change or clear the filters above.</p>
      </section>
    ) : (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="font-medium">No issues yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Press <kbd className="rounded border px-1 font-mono text-xs">C</kbd> or use “Create” in
          the top bar to add the first one.
        </p>
      </section>
    );
    return (
      <div>
        {live}
        {empty}
      </div>
    );
  }

  const sortHref = (key: IssueSortKey) => {
    const dir =
      sort.by === key
        ? sort.dir === "asc"
          ? "desc"
          : "asc"
        : DESC_FIRST.has(key)
          ? "desc"
          : "asc";
    const query = listFiltersQuery(filters, listDefaults ?? null, {
      sort: key,
      dir,
      view: viewId,
    }).toString();
    return `/${projectKey}/issues?${query}`;
  };
  const sortLabel = COLUMNS.find((column) => column.key === sort.by)?.label ?? "Created";

  return (
    <div ref={container} className="flex flex-col gap-2">
      {live}
      {/* Before the rows, so it is a few Tab stops away, not one per row (§9.5). */}
      <BulkBar
        count={selection.selectedIds.length}
        visibleCount={shown.length}
        options={bulkOptions}
        pending={pending}
        onApply={runBulk}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
      />
      {releases ? (
        <div className="flex justify-end">
          <MultiSelect
            variant="chip"
            label="Columns"
            aria-label="Optional columns"
            value={columns.shown}
            options={[{ value: "release" as const, label: "Fix version" }]}
            onChange={(_next, change) => columns.toggle(change.value, change.selected)}
          >
            {() => (
              <>
                <Columns3 aria-hidden="true" />
                Columns
              </>
            )}
          </MultiSelect>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Issues in {projectKey}, sorted by {sortLabel.toLowerCase()},{" "}
            {sort.dir === "asc" ? "ascending" : "descending"}. Press J and K to move between rows, X
            to select one.
          </caption>
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-8 py-2 pl-3">
                <SelectAllCheckbox
                  label="Select all shown issues"
                  all={selection.allSelected}
                  some={selection.someSelected}
                  onChange={(all) => (all ? selection.selectAll() : selection.clear())}
                />
              </th>
              {COLUMNS.map((column) => {
                const active = sort.by === column.key;
                const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                    className={cn("py-2 font-medium", column.className)}
                  >
                    <Link
                      href={sortHref(column.key)}
                      scroll={false}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        active && "text-foreground",
                      )}
                    >
                      <span className={column.srOnly ? "sr-only" : undefined}>
                        {column.label}
                        <span className="sr-only">, sort</span>
                      </span>
                      <Icon aria-hidden="true" className="size-3" />
                    </Link>
                  </th>
                );
              })}
              {showRelease ? (
                <th scope="col" className="w-36 px-3 py-2 font-medium">
                  Fix version
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((issue) => {
              const href = `/${projectKey}/issues/${issue.key}`;
              const selected = selection.isSelected(issue.id);
              return (
                <tr
                  key={issue.id}
                  {...NAV_ITEM}
                  {...selectRowProps(issue.id)}
                  className={cn(
                    "border-b last:border-b-0 focus-within:bg-muted/60 hover:bg-muted/40",
                    selected && "bg-primary/5",
                  )}
                >
                  <td className="py-2 pl-3">
                    <RowCheckbox
                      label={`Select ${issue.key}`}
                      checked={selected}
                      onToggle={(range) => selection.toggle(issue.id, range)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                    <Link href={href} tabIndex={-1} className="hover:underline">
                      {issue.key}
                    </Link>
                  </td>
                  <td className="px-1 py-2">
                    <IssueTypeIcon type={issue.type} />
                  </td>
                  <td className="max-w-0 px-3 py-2">
                    <Link
                      href={href}
                      {...NAV_LINK}
                      className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="sr-only">{issue.key}: </span>
                      {issue.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge name={issue.status.name} category={issue.status.category} />
                  </td>
                  <td className="px-3 py-2">
                    <PriorityLabel priority={issue.priority} short />
                  </td>
                  <td className="px-3 py-2">
                    {issue.assignee ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={issue.assignee.name} />
                        <span className="truncate">{issue.assignee.name}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {issue.storyPoints ?? <span className="text-muted-foreground">–</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    <RelativeTime date={issue.updatedAt} />
                  </td>
                  {showRelease ? (
                    <td className="max-w-0 truncate px-3 py-2">
                      {(issue.releaseId && releaseNames.get(issue.releaseId)) ?? (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
