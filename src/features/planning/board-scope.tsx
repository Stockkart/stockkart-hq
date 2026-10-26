"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useTransition } from "react";

import { Select, type SelectOption } from "@/components/ui/select";
import { type BoardSelection, boardHref } from "@/lib/sprints/schemas";
import { type SprintOption } from "@/lib/sprints/views";

/** The picker's value for "All open" (never a sprint id, which is a uuid). */
const ALL_OPEN = "all";

/** The picker value a selection shows: the sprint on the board, or "All open". */
export function pickerValue(selection: BoardSelection, activeSprintId: string | null): string {
  if (selection.scope === "all") return ALL_OPEN;
  return selection.sprintId ?? activeSprintId ?? ALL_OPEN;
}

/** The selection a picked value stands for; the active sprint is the default (plain URL). */
export function selectionOf(value: string, activeSprintId: string | null): BoardSelection {
  if (value === ALL_OPEN) {
    // Without an active sprint the default already is every open issue.
    return activeSprintId ? { scope: "all", sprintId: null } : { scope: "sprint", sprintId: null };
  }
  return { scope: "sprint", sprintId: value === activeSprintId ? null : value };
}

/**
 * BRD-3 sprint picker: the active sprint, any planned one, or "All open". The choice lives
 * in the URL (`?sprint=<id>`, `?scope=all`; the plain URL is the active sprint), so it
 * survives reloads, can be shared, and the sidebar link reopens it (VW-5).
 */
export function BoardSprintPicker({
  projectKey,
  selection,
  sprints,
  viewQuery,
}: {
  projectKey: string;
  selection: BoardSelection;
  /** The open sprints, the active one first (`ProjectMeta.sprints`). */
  sprints: SprintOption[];
  /** BRD-6: the type and column params, kept when the sprint changes. */
  viewQuery?: URLSearchParams;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const activeSprintId = sprints.find((sprint) => sprint.state === "active")?.id ?? null;
  // Shown at once while the new URL renders.
  const [value, showValue] = useOptimistic(pickerValue(selection, activeSprintId));
  const options: SelectOption<string>[] = [
    ...sprints.map((sprint) => ({
      value: sprint.id,
      label: sprint.name,
      detail: sprint.state === "active" ? "Active" : "Planned",
    })),
    { value: ALL_OPEN, label: "All open" },
  ];

  return (
    <div className="flex items-center gap-2 text-sm" aria-busy={pending || undefined}>
      <label htmlFor={id} className="text-muted-foreground">
        Sprint
      </label>
      <Select
        id={id}
        variant="chip"
        label="Sprint"
        value={value}
        options={options}
        onChange={(picked) => {
          if (picked === null || picked === value) return;
          const href = boardHref(projectKey, selectionOf(picked, activeSprintId), viewQuery);
          startTransition(() => {
            showValue(picked);
            router.push(href, { scroll: false });
          });
        }}
      />
    </div>
  );
}
