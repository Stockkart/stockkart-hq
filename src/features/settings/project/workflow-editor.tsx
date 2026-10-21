"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import { type ActionResult } from "@/lib/action-result";
import { statusOptions } from "@/features/issue/field-options";
import { StatusGlyph } from "@/features/issue/issue-badges";
import { MoveMenu } from "@/features/planning/move-menu";
import {
  STATUS_CATEGORIES,
  type StatusCategory,
  type StatusDefaultFor,
} from "@/lib/issues/constants";
import { applyMove, availableMoves, dropOnto, moveBy, type MoveKind } from "@/lib/planning/reorder";
import { STATUS_NAME_MAX } from "@/lib/settings/constants";
import { type StatusSetting } from "@/lib/settings/views";
import { WONT_DO_STATUS_NAME } from "@/lib/sprints/constants";
import {
  createStatusAction,
  deleteStatusAction,
  moveStatusAction,
  renameStatusAction,
  setStatusCategoryAction,
  setStatusDefaultAction,
} from "@/server/actions/settings";

import { InlineText } from "./inline-text";

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
const DEFAULT_LABELS: Record<StatusDefaultFor, string> = {
  bug: "Default for bugs",
  other: "Default for other issues",
};
const CATEGORY_OPTIONS: SelectOption<StatusCategory>[] = STATUS_CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
  icon: <StatusGlyph category={category} />,
}));

type Change =
  | { kind: "add"; status: StatusSetting }
  | { kind: "rename"; id: string; name: string }
  | { kind: "category"; id: string; category: StatusCategory }
  | { kind: "default"; id: string; defaultFor: StatusDefaultFor }
  | { kind: "move"; id: string; afterId: string | null }
  | { kind: "delete"; id: string; moveTo: string | null };

function reduce(statuses: StatusSetting[], change: Change): StatusSetting[] {
  switch (change.kind) {
    case "add":
      return [...statuses, change.status];
    case "rename":
      return statuses.map((s) => (s.id === change.id ? { ...s, name: change.name } : s));
    case "category":
      return statuses.map((s) => (s.id === change.id ? { ...s, category: change.category } : s));
    case "default":
      return statuses.map((s) =>
        s.id === change.id
          ? { ...s, isDefaultFor: change.defaultFor }
          : s.isDefaultFor === change.defaultFor
            ? { ...s, isDefaultFor: null }
            : s,
      );
    case "move":
      return applyMove(statuses, change.id, change.afterId);
    case "delete": {
      const gone = statuses.find((s) => s.id === change.id);
      return statuses
        .filter((s) => s.id !== change.id)
        .map((s) =>
          gone && s.id === change.moveTo
            ? {
                ...s,
                issueCount: s.issueCount + gone.issueCount,
                trashedCount: s.trashedCount + gone.trashedCount,
              }
            : s,
        );
    }
  }
}

/**
 * PRJ-3 workflow: add, rename, reorder (drag, or the row menu), change category, set the
 * default for bugs / other issues, and delete (moving its issues to another status when it
 * is in use). Every change is optimistic; the server enforces the rules (one status per
 * category at least, one default per kind) and a refused change rolls back with its reason.
 */
export function WorkflowEditor({
  projectKey,
  statuses,
}: {
  projectKey: string;
  statuses: StatusSetting[];
}) {
  const [shown, apply] = useOptimistic(statuses, reduce);
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [deleting, setDeleting] = useState<StatusSetting | null>(null);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = shown.map((status) => status.id);

  function run<T>(change: Change, action: () => Promise<ActionResult<T>>, said: string) {
    startTransition(async () => {
      apply(change);
      const ok = (await callAction(action)) !== null;
      setAnnouncement(ok ? said : "That change was not saved");
    });
  }

  function move(id: string, afterId: string | null, said: string) {
    run(
      { kind: "move", id, afterId },
      () => moveStatusAction({ statusId: id, afterStatusId: afterId }),
      said,
    );
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const reorder = dropOnto(ids, String(event.active.id), String(event.over.id));
    if (reorder) move(String(event.active.id), reorder.afterId, "Status moved");
  }

  function onMenuMove(id: string, kind: MoveKind) {
    const reorder = moveBy(ids, id, kind);
    if (!reorder) return;
    move(id, reorder.afterId, `Status moved to position ${reorder.order.indexOf(id) + 1}`);
  }

  return (
    <section aria-labelledby={`${dndId}-title`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${dndId}-title`} className="text-lg font-medium">
          Statuses
        </h2>
        <p className="text-sm text-muted-foreground">
          Board columns, in this order. Reports count by category; “{WONT_DO_STATUS_NAME}” is left
          out of velocity by its name, so it keeps it.
        </p>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="divide-y rounded-lg border">
            {shown.map((status, index) => (
              <StatusRow
                key={status.id}
                status={status}
                available={availableMoves(index, ids.length)}
                onMove={(kind) => onMenuMove(status.id, kind)}
                onRename={(name) =>
                  run(
                    { kind: "rename", id: status.id, name },
                    () => renameStatusAction({ statusId: status.id, name }),
                    `Renamed to ${name}`,
                  )
                }
                onCategory={(category) =>
                  run(
                    { kind: "category", id: status.id, category },
                    () => setStatusCategoryAction({ statusId: status.id, category }),
                    `${status.name} is now ${CATEGORY_LABELS[category]}`,
                  )
                }
                onDefault={(defaultFor) =>
                  run(
                    { kind: "default", id: status.id, defaultFor },
                    () => setStatusDefaultAction({ statusId: status.id, kind: defaultFor }),
                    `${status.name}: ${DEFAULT_LABELS[defaultFor].toLowerCase()}`,
                  )
                }
                onDelete={() => setDeleting(status)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AddStatusForm
        onAdd={(name, category) =>
          run(
            {
              kind: "add",
              status: {
                id: `new:${crypto.randomUUID()}`,
                name,
                category,
                position: shown.length,
                isDefaultFor: null,
                issueCount: 0,
                trashedCount: 0,
              },
            },
            () => createStatusAction({ projectKey, name, category }),
            `Added ${name}`,
          )
        }
      />
      {deleting ? (
        <DeleteStatusDialog
          status={deleting}
          others={shown.filter((status) => status.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDelete={(moveTo) =>
            run(
              { kind: "delete", id: deleting.id, moveTo },
              () => deleteStatusAction({ statusId: deleting.id, moveToStatusId: moveTo }),
              `Deleted ${deleting.name}`,
            )
          }
        />
      ) : null}
    </section>
  );
}

function StatusRow({
  status,
  available,
  onMove,
  onRename,
  onCategory,
  onDefault,
  onDelete,
}: {
  status: StatusSetting;
  available: Record<MoveKind, boolean>;
  onMove: (kind: MoveKind) => void;
  onRename: (name: string) => void;
  onCategory: (category: StatusCategory) => void;
  onDefault: (kind: StatusDefaultFor) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition } =
    useSortable({ id: status.id, disabled: status.id.startsWith("new:") });
  const pending = status.id.startsWith("new:");
  const used = status.issueCount + status.trashedCount;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex flex-wrap items-center gap-2 bg-background px-2 py-1.5 text-sm"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${status.name} (space to pick up, arrows to move, space to drop)`}
        className="cursor-grab touch-none rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <InlineText
        label={`Name of ${status.name}`}
        value={status.name}
        maxLength={STATUS_NAME_MAX}
        className="w-48"
        validate={(next) => (next ? null : "Name is required")}
        onCommit={onRename}
      />
      <Select
        aria-label={`Category of ${status.name}`}
        label={`Category of ${status.name}`}
        className="w-40"
        value={status.category}
        options={CATEGORY_OPTIONS}
        disabled={pending}
        onChange={(next) => {
          if (next && next !== status.category) onCategory(next);
        }}
      />
      <span className="flex-1 text-xs text-muted-foreground">
        {status.isDefaultFor ? (
          <span className="mr-2 rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
            {DEFAULT_LABELS[status.isDefaultFor]}
          </span>
        ) : null}
        {status.issueCount} {status.issueCount === 1 ? "issue" : "issues"}
        {status.trashedCount > 0 ? ` (+${status.trashedCount} in the trash)` : null}
      </span>
      {pending ? null : (
        <MoveMenu itemLabel={status.name} available={available} onMove={onMove}>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={status.isDefaultFor === "bug" || status.category === "done"}
            onSelect={() => onDefault("bug")}
          >
            Make default for bugs
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={status.isDefaultFor === "other" || status.category === "done"}
            onSelect={() => onDefault("other")}
          >
            Make default for other issues
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            disabled={status.isDefaultFor !== null}
            onSelect={onDelete}
          >
            {used > 0 ? "Delete and move its issues…" : "Delete…"}
          </DropdownMenuItem>
        </MoveMenu>
      )}
    </li>
  );
}

function AddStatusForm({ onAdd }: { onAdd: (name: string, category: StatusCategory) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StatusCategory>("todo");
  const ids = { name: useId(), category: useId() };
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.replace(/\s+/g, " ").trim();
        if (!trimmed) return;
        onAdd(trimmed, category);
        setName("");
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>New status</Label>
        <Input
          id={ids.name}
          value={name}
          maxLength={STATUS_NAME_MAX}
          autoComplete="off"
          placeholder="e.g. QA"
          className="h-8 w-48"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.category}>Category</Label>
        <Select
          id={ids.category}
          label="Category"
          className="w-40"
          value={category}
          options={CATEGORY_OPTIONS}
          onChange={(next) => {
            if (next) setCategory(next);
          }}
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={!name.trim()}>
        <Plus aria-hidden="true" />
        Add status
      </Button>
    </form>
  );
}

function DeleteStatusDialog({
  status,
  others,
  onClose,
  onDelete,
}: {
  status: StatusSetting;
  others: StatusSetting[];
  onClose: () => void;
  onDelete: (moveTo: string | null) => void;
}) {
  const used = status.issueCount + status.trashedCount;
  const [target, setTarget] = useState<string | null>(null);
  const targetId = useId();
  const choices = others.filter((other) => !other.id.startsWith("new:"));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete status “{status.name}”?</DialogTitle>
          <DialogDescription>
            {used === 0
              ? "No issue uses it."
              : `${used} ${used === 1 ? "issue uses" : "issues use"} it${status.trashedCount > 0 ? ` (${status.trashedCount} in the trash)` : ""}. Pick where ${used === 1 ? "it goes" : "they go"}; each move is recorded in the issue’s history.`}
          </DialogDescription>
        </DialogHeader>
        {used > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={targetId}>Move issues to</Label>
            <Select
              id={targetId}
              label="Move issues to"
              value={target}
              placeholder="Pick a status"
              options={statusOptions(choices)}
              onChange={setTarget}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={used > 0 && !target}
            onClick={() => {
              onClose();
              onDelete(used > 0 ? target : null);
            }}
          >
            Delete status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
