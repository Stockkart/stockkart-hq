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
import { Bookmark, GripVertical, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
import { callAction } from "@/features/issue/client-utils";
import { MoveMenu } from "@/features/planning/move-menu";
import { applyMove, availableMoves, dropOnto, moveBy, type MoveKind } from "@/lib/planning/reorder";
import { cn } from "@/lib/utils";
import { type SavedViewItem, VIEW_NAME_MAX, VIEW_PARAM, viewHref } from "@/lib/views/saved-views";
import {
  deleteViewAction,
  moveViewAction,
  renameViewAction,
  setViewSharedAction,
} from "@/server/actions/saved-views";

type Change =
  | { kind: "move"; id: string; afterId: string | null }
  | { kind: "rename"; id: string; name: string }
  | { kind: "share"; id: string; shared: boolean }
  | { kind: "delete"; id: string };

function reduce(views: SavedViewItem[], change: Change): SavedViewItem[] {
  switch (change.kind) {
    case "move": {
      const mine = applyMove(
        views.filter((view) => view.mine),
        change.id,
        change.afterId,
      );
      return [...mine, ...views.filter((view) => !view.mine)];
    }
    case "rename":
      return views.map((view) => (view.id === change.id ? { ...view, name: change.name } : view));
    case "share":
      return views.map((view) =>
        view.id === change.id ? { ...view, shared: change.shared } : view,
      );
    case "delete":
      return views.filter((view) => view.id !== change.id);
  }
}

const ITEM =
  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * VW-3 in the sidebar: the user's own views (drag, or the row menu, to reorder; rename,
 * share and delete there too), then the views others shared. Every change is optimistic;
 * a failed action rolls back when its transition ends without new data.
 */
export function SidebarViews({
  projectKey,
  views,
}: {
  projectKey: string;
  views: SavedViewItem[];
}) {
  const [shown, apply] = useOptimistic(views, reduce);
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; view: SavedViewItem } | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = pathname === `/${projectKey}/issues` ? searchParams.get(VIEW_PARAM) : null;
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const mine = shown.filter((view) => view.mine);
  const others = shown.filter((view) => !view.mine);
  const mineIds = mine.map((view) => view.id);

  function run(change: Change, action: () => ReturnType<typeof moveViewAction>, said: string) {
    startTransition(async () => {
      apply(change);
      const ok = (await callAction(action)) !== null;
      setAnnouncement(ok ? said : "That change to the view was not saved");
    });
  }

  function move(id: string, afterId: string | null, said: string) {
    run(
      { kind: "move", id, afterId },
      () => moveViewAction({ viewId: id, afterViewId: afterId }),
      said,
    );
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const reorder = dropOnto(mineIds, String(event.active.id), String(event.over.id));
    if (reorder) move(String(event.active.id), reorder.afterId, "View moved");
  }

  function onMenuMove(id: string, kind: MoveKind) {
    const reorder = moveBy(mineIds, id, kind);
    if (!reorder) return;
    const position = reorder.order.indexOf(id) + 1;
    move(id, reorder.afterId, `View moved to position ${position} of ${mineIds.length}`);
  }

  if (shown.length === 0) return null;

  return (
    <div className="mt-2">
      <h3 id={`${dndId}-views`} className="px-2 pb-1 text-xs text-muted-foreground">
        Views
      </h3>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={mineIds} strategy={verticalListSortingStrategy}>
          <ul aria-labelledby={`${dndId}-views`} className="flex flex-col gap-0.5">
            {mine.map((view, index) => (
              <OwnViewRow
                key={view.id}
                view={view}
                href={viewHref(projectKey, view)}
                active={activeId === view.id}
                available={availableMoves(index, mineIds.length)}
                onMove={(kind) => onMenuMove(view.id, kind)}
                onRename={() => setDialog({ kind: "rename", view })}
                onDelete={() => setDialog({ kind: "delete", view })}
                onShare={(shared) =>
                  run(
                    { kind: "share", id: view.id, shared },
                    () => setViewSharedAction({ viewId: view.id, shared }),
                    shared ? `Shared “${view.name}”` : `“${view.name}” is private now`,
                  )
                }
              />
            ))}
            {others.map((view) => (
              <li key={view.id}>
                <Link
                  href={viewHref(projectKey, view)}
                  aria-current={activeId === view.id ? "page" : undefined}
                  title={`Shared by ${view.ownerName ?? "someone"}`}
                  className={cn(ITEM, activeId === view.id && "bg-sidebar-accent font-medium")}
                >
                  <Users aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">{view.name}</span>
                  <span className="sr-only">, shared by {view.ownerName ?? "someone"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {dialog?.kind === "rename" ? (
        <RenameDialog
          view={dialog.view}
          onClose={() => setDialog(null)}
          onRename={(name) =>
            run(
              { kind: "rename", id: dialog.view.id, name },
              () => renameViewAction({ viewId: dialog.view.id, name }),
              `Renamed to “${name}”`,
            )
          }
        />
      ) : null}
      <Dialog open={dialog?.kind === "delete"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete view “{dialog?.view.name}”?</DialogTitle>
            <DialogDescription>
              Only the saved filters go{dialog?.view.shared ? ", for everyone" : ""}; no issue
              changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const view = dialog?.view;
                setDialog(null);
                if (view) {
                  run(
                    { kind: "delete", id: view.id },
                    () => deleteViewAction({ viewId: view.id }),
                    `Deleted “${view.name}”`,
                  );
                }
              }}
            >
              Delete view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OwnViewRow({
  view,
  href,
  active,
  available,
  onMove,
  onRename,
  onDelete,
  onShare,
}: {
  view: SavedViewItem;
  href: string;
  active: boolean;
  available: Record<MoveKind, boolean>;
  onMove: (kind: MoveKind) => void;
  onRename: () => void;
  onDelete: () => void;
  onShare: (shared: boolean) => void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition } =
    useSortable({ id: view.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="group flex items-center"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder view ${view.name} (space to pick up, arrows to move, space to drop)`}
        className="cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <GripVertical aria-hidden="true" className="size-3.5" />
      </button>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(ITEM, "px-1", active && "bg-sidebar-accent font-medium")}
      >
        {view.shared ? (
          <Users aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <Bookmark aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="truncate">{view.name}</span>
        {view.shared ? <span className="sr-only">, shared</span> : null}
      </Link>
      <MoveMenu itemLabel={`view ${view.name}`} available={available} onMove={onMove}>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onRename}>Rename…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onShare(!view.shared)}>
          {view.shared ? "Make private" : "Share with the team"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-destructive">
          Delete…
        </DropdownMenuItem>
      </MoveMenu>
    </li>
  );
}

function RenameDialog({
  view,
  onClose,
  onRename,
}: {
  view: SavedViewItem;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(view.name);
  const inputId = useId();
  const trimmed = name.replace(/\s+/g, " ").trim();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            onClose();
            if (trimmed !== view.name) onRename(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
            <DialogDescription>The filters stay as they are.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              id={inputId}
              value={name}
              maxLength={VIEW_NAME_MAX}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
