"use client";

import { Trash2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  labelOptions,
  priorityOptions,
  releaseOptions,
  sprintOptions,
  statusOptions,
  userOptions,
} from "@/features/issue/field-options";
import { BULK_MAX, type BulkChange } from "@/lib/issues/bulk";
import { type LabelView, type NamedOption, type StatusOption } from "@/lib/issues/views";
import { type ReleaseOption } from "@/lib/releases/views";
import { type SprintOption } from "@/lib/sprints/views";

/** "Unassigned" / "Backlog" in the pickers (a value, unlike a cleared picker). */
const NONE = "none";

export interface BulkOptions {
  statuses: StatusOption[];
  users: NamedOption[];
  labels: LabelView[];
  sprints: SprintOption[];
  /** REL-1 "Fix version" picker; without it the bar shows no such picker. */
  releases?: ReleaseOption[];
}

interface BulkBarProps {
  count: number;
  visibleCount: number;
  options: BulkOptions;
  onApply: (change: BulkChange, description: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  pending?: boolean;
}

const plural = (count: number) => `${count} ${count === 1 ? "issue" : "issues"}`;

/**
 * ISS-12 bulk bar, shown while rows are selected: set status, priority, assignee, sprint or
 * fix version (REL-1), add or remove a label, or delete, for every selected issue at once.
 * Each picker applies
 * on pick (one deliberate choice); delete asks first. A named group placed BEFORE the rows,
 * so keyboard users reach it in a few Tab stops (Shift+Tab from the list).
 */
export function BulkBar({
  count,
  visibleCount,
  options,
  onApply,
  onSelectAll,
  onClear,
  pending = false,
}: BulkBarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Holds the bar's place while nothing is selected, so the first checkbox click does not
  // push the rows down under the pointer (a quick shift-click would land on another row).
  if (count === 0) {
    return (
      <p className="flex h-12 items-center px-3 text-sm text-muted-foreground">
        Select issues (checkbox or{" "}
        <kbd className="mx-1 rounded border px-1 font-mono text-xs">X</kbd>) to edit them together.
      </p>
    );
  }
  const tooMany = count > BULK_MAX;
  const disabled = pending || tooMany;
  const what = plural(count);

  const assigneeOptions: SelectOption<string>[] = [
    { value: NONE, label: "Unassigned" },
    ...userOptions(options.users),
  ];
  const sprintPicker: SelectOption<string>[] = [
    { value: NONE, label: "Backlog" },
    ...sprintOptions(options.sprints),
  ];

  return (
    <div
      role="group"
      aria-label={`Bulk edit ${what}`}
      className="sticky top-2 z-20 flex min-h-12 flex-wrap items-center gap-2 rounded-lg border bg-background p-2 text-sm shadow-md"
    >
      <span className="px-1 font-medium tabular-nums" aria-live="polite">
        {what} selected
      </span>
      {count < visibleCount ? (
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          Select all {visibleCount}
        </Button>
      ) : null}
      {tooMany ? (
        <span role="alert" className="text-destructive">
          At most {BULK_MAX} at once
        </span>
      ) : null}
      <Select
        variant="chip"
        label="Set status"
        aria-label={`Set status of ${what}`}
        placeholder="Status"
        disabled={disabled}
        value={null}
        options={statusOptions(options.statuses)}
        onChange={(statusId) => {
          const name = options.statuses.find((status) => status.id === statusId)?.name;
          if (statusId) onApply({ kind: "status", statusId }, `Moved ${what} to ${name}`);
        }}
      />
      <Select
        variant="chip"
        label="Set priority"
        aria-label={`Set priority of ${what}`}
        placeholder="Priority"
        disabled={disabled}
        value={null}
        options={priorityOptions()}
        onChange={(priority) => {
          if (priority !== null) {
            onApply({ kind: "priority", priority }, `Set priority P${priority} on ${what}`);
          }
        }}
      />
      <Select
        variant="chip"
        label="Set assignee"
        aria-label={`Set assignee of ${what}`}
        placeholder="Assignee"
        disabled={disabled}
        value={null}
        options={assigneeOptions}
        onChange={(value) => {
          if (value === null) return;
          const assigneeId = value === NONE ? null : value;
          const name = options.users.find((user) => user.id === assigneeId)?.name;
          onApply(
            { kind: "assignee", assigneeId },
            assigneeId ? `Assigned ${what} to ${name}` : `Unassigned ${what}`,
          );
        }}
      />
      <Select
        variant="chip"
        label="Set sprint"
        aria-label={`Move ${what} to a sprint`}
        placeholder="Sprint"
        disabled={disabled}
        value={null}
        options={sprintPicker}
        onChange={(value) => {
          if (value === null) return;
          const sprintId = value === NONE ? null : value;
          const name = options.sprints.find((sprint) => sprint.id === sprintId)?.name;
          onApply(
            { kind: "sprint", sprintId },
            sprintId ? `Moved ${what} to ${name}` : `Moved ${what} to the backlog`,
          );
        }}
      />
      {options.releases ? (
        <Select
          variant="chip"
          label="Set fix version"
          aria-label={`Set the fix version of ${what}`}
          placeholder="Fix version"
          disabled={disabled}
          value={null}
          options={[{ value: NONE, label: "None" }, ...releaseOptions(options.releases)]}
          onChange={(value) => {
            if (value === null) return;
            const releaseId = value === NONE ? null : value;
            const name = options.releases?.find((release) => release.id === releaseId)?.name;
            onApply(
              { kind: "release", releaseId },
              releaseId
                ? `Set fix version ${name} on ${what}`
                : `Cleared the fix version of ${what}`,
            );
          }}
        />
      ) : null}
      <Select
        variant="chip"
        label="Add label"
        aria-label={`Add a label to ${what}`}
        placeholder="Add label"
        disabled={disabled || options.labels.length === 0}
        value={null}
        options={labelOptions(options.labels)}
        onChange={(labelId) => {
          const name = options.labels.find((label) => label.id === labelId)?.name;
          if (labelId) onApply({ kind: "addLabels", labelIds: [labelId] }, `Added ${name}`);
        }}
      />
      <Select
        variant="chip"
        label="Remove label"
        aria-label={`Remove a label from ${what}`}
        placeholder="Remove label"
        disabled={disabled || options.labels.length === 0}
        value={null}
        options={labelOptions(options.labels)}
        onChange={(labelId) => {
          const name = options.labels.find((label) => label.id === labelId)?.name;
          if (labelId) onApply({ kind: "removeLabels", labelIds: [labelId] }, `Removed ${name}`);
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"
        disabled={disabled}
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 aria-hidden="true" />
        Delete
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <X aria-hidden="true" />
        Clear selection
      </Button>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {what}?</DialogTitle>
            <DialogDescription>
              They move to the project’s trash, where they can be restored for 30 days.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false);
                onApply({ kind: "delete" }, `Deleted ${what}`);
              }}
            >
              Delete {what}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
