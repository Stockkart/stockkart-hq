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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { callAction } from "@/features/issue/client-utils";
import { STOCKKART_DEFAULT_COSTS } from "@/lib/costs/defaults";
import { formatMoney } from "@/lib/costs/money";
import { type CostItemView, type CostServiceOption } from "@/lib/costs/views";
import { servicePath } from "@/lib/service-registry/slug";
import { cn } from "@/lib/utils";
import {
  addDefaultCostsAction,
  deleteCostItemAction,
  moveCostItemAction,
  setCostItemActiveAction,
} from "@/server/actions/costs";

import { CategoryChip, CycleLabel } from "./cost-bits";
import { CostItemFormDialog } from "./item-form-dialog";

/**
 * COST-1/6 Items tab: the cost items in list order (drag to reorder, or "Move up/down" in
 * the row menu from the keyboard), "New item", "Add Stockkart defaults", edit, archive /
 * reactivate and delete. Moves, archives and deletes show at once and roll back if the
 * server refuses.
 */
export function ItemsTab({
  projectKey,
  items: serverItems,
  services,
}: {
  projectKey: string;
  items: CostItemView[];
  services: CostServiceOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(serverItems);
  const [seen, setSeen] = useState(serverItems);
  if (seen !== serverItems) {
    setSeen(serverItems);
    setItems(serverItems);
  }
  const [editing, setEditing] = useState<CostItemView | "new" | null>(null);
  const [deleting, setDeleting] = useState<CostItemView | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [addingDefaults, startDefaults] = useTransition();
  const [, startTransition] = useTransition();
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const names = new Set(items.map((item) => item.name.toLowerCase()));
  const missingDefaults = STOCKKART_DEFAULT_COSTS.filter(
    (entry) => !names.has(entry.name.toLowerCase()),
  );

  function move(id: string, to: number) {
    const from = items.findIndex((item) => item.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const previous = items;
    setItems(arrayMove(items, from, to));
    startTransition(async () => {
      const result = await callAction(() => moveCostItemAction({ itemId: id, index: to }));
      if (result === null) {
        setItems(previous);
        setAnnouncement("The item could not be moved");
      } else {
        setAnnouncement(`Moved to position ${to + 1} of ${items.length}`);
      }
    });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const to = items.findIndex((item) => item.id === event.over?.id);
    move(String(event.active.id), to);
  }

  function setActive(item: CostItemView, active: boolean) {
    const previous = items;
    setItems(items.map((entry) => (entry.id === item.id ? { ...entry, active } : entry)));
    startTransition(async () => {
      const result = await callAction(() => setCostItemActiveAction({ itemId: item.id, active }));
      if (result === null) setItems(previous);
      else setAnnouncement(`${item.name} ${active ? "reactivated" : "archived"}`);
    });
  }

  function addDefaults() {
    startDefaults(async () => {
      const result = await callAction(() => addDefaultCostsAction({ projectKey }));
      if (!result) return;
      toast.success(
        result.created.length > 0
          ? `Added ${result.created.length} items. Enter their amounts on the Month tab.`
          : "The Stockkart defaults are already here.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          What Stockkart pays for. Archived items are no longer expected; their past months still
          count.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            New item
          </Button>
          {missingDefaults.length > 0 ? (
            <Button size="sm" variant="outline" disabled={addingDefaults} onClick={addDefaults}>
              <PackagePlus aria-hidden="true" />
              Add Stockkart defaults
            </Button>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No cost items yet. Add one, or start with the Stockkart defaults (names only; you enter
          the amounts).
        </p>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="divide-y rounded-lg border" aria-label="Cost items">
              {items.map((item, index) => (
                <SortableItemRow
                  key={item.id}
                  projectKey={projectKey}
                  item={item}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                  onMove={(delta) => move(item.id, index + delta)}
                  onEdit={() => setEditing(item)}
                  onSetActive={(active) => setActive(item, active)}
                  onDelete={() => setDeleting(item)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editing ? (
        <CostItemFormDialog
          projectKey={projectKey}
          services={services}
          item={editing === "new" ? undefined : editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteItemDialog
          item={deleting}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onDeleted={() => {
            setItems((current) => current.filter((item) => item.id !== deleting.id));
            setAnnouncement(`Deleted ${deleting.name}`);
          }}
        />
      ) : null}
    </div>
  );
}

function SortableItemRow({
  projectKey,
  item,
  isFirst,
  isLast,
  onMove,
  onEdit,
  onSetActive,
  onDelete,
}: {
  projectKey: string;
  item: CostItemView;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onSetActive: (active: boolean) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex flex-wrap items-center gap-3 bg-card px-3 py-2 text-sm",
        isDragging && "relative z-10 shadow-lg",
        !item.active && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${item.name} to reorder (or use the menu)`}
        className="cursor-grab rounded p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <div className="flex min-w-48 flex-1 flex-col">
        <span className="font-medium">
          {item.name}
          {!item.active ? <span className="ml-2 text-xs font-normal">(archived)</span> : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {item.vendor ? <span>{item.vendor}</span> : null}
          <CycleLabel cycle={item.billingCycle} />
          <span>{item.currency}</span>
          {item.renewsOn ? <span>renews {item.renewsOn}</span> : null}
        </span>
      </div>
      <CategoryChip category={item.category} />
      <span className="w-32 text-right text-xs tabular-nums">
        {item.expectedAmountMinor !== null ? (
          <>
            <span className="sr-only">Expected </span>
            {formatMoney(item.expectedAmountMinor, item.currency)}
          </>
        ) : (
          <span className="text-muted-foreground">No expected amount</span>
        )}
      </span>
      <span className="w-36 truncate text-xs">
        {item.service ? (
          <Link href={servicePath(projectKey, item.service.slug)} className="hover:underline">
            <span className="sr-only">Service </span>
            {item.service.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">No service</span>
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${item.name}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden="true" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isFirst} onSelect={() => onMove(-1)}>
            <ArrowUp aria-hidden="true" />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onSelect={() => onMove(1)}>
            <ArrowDown aria-hidden="true" />
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSetActive(!item.active)}>
            {item.active ? <Archive aria-hidden="true" /> : <ArchiveRestore aria-hidden="true" />}
            {item.active ? "Archive" : "Reactivate"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} className="text-destructive">
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** Soft delete (§9.3) after a confirmation: the item and its months leave every total. */
function DeleteItemDialog({
  item,
  onOpenChange,
  onDeleted,
}: {
  item: CostItemView;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {item.name}?</DialogTitle>
          <DialogDescription>
            It and every month entered for it disappear from the totals. To stop expecting it but
            keep its history, archive it instead.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await callAction(() => deleteCostItemAction({ itemId: item.id }));
                if (result === null) return;
                onDeleted();
                onOpenChange(false);
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
