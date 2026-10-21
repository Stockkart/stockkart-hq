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
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { DIAGRAM_KIND_LABELS, type DiagramKind } from "@/lib/diagrams/constants";
import { diagramPath } from "@/lib/diagrams/links";
import { type DiagramCard } from "@/lib/diagrams/views";
import { cn } from "@/lib/utils";
import { moveDiagramAction } from "@/server/actions/diagrams";

import { DeleteDiagramDialog, NewDiagramDialog, RenameDiagramDialog } from "./diagram-dialogs";
import { DiagramKindIcon, DiagramThumbnail } from "./diagram-thumbnail";

type Dialog =
  | { kind: "new"; diagramKind: DiagramKind | null }
  | { kind: "rename"; card: DiagramCard }
  | { kind: "delete"; card: DiagramCard };

/**
 * §5.6 diagram list: a grid of cards (thumbnail, title, kind, owner, updated), "New
 * whiteboard" / "New flow" / "New from template", search, and drag to reorder (with "Move
 * earlier/later" in each card's menu as the keyboard alternative). Every change shows at
 * once and is rolled back if the server refuses.
 */
export function DiagramList({
  projectKey,
  diagrams,
  query,
}: {
  projectKey: string;
  diagrams: DiagramCard[];
  query: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState(diagrams);
  const [seen, setSeen] = useState(diagrams);
  if (seen !== diagrams) {
    // The server re-rendered (after an action or a refresh): its order is the truth.
    setSeen(diagrams);
    setItems(diagrams);
  }
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [search, setSearch] = useState(query);
  const [, startTransition] = useTransition();
  const ids = { search: useId(), dnd: useId() };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Ordering a filtered list would be ambiguous (where among the hidden ones?).
  const canReorder = !query;

  function move(id: string, to: number) {
    const from = items.findIndex((item) => item.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const previous = items;
    setItems(arrayMove(items, from, to));
    startTransition(async () => {
      const result = await callAction(() => moveDiagramAction({ diagramId: id, index: to }));
      if (result === null) {
        setItems(previous);
        setAnnouncement("The diagram could not be moved");
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

  function patch(id: string, change: Partial<DiagramCard> | null) {
    setItems((current) =>
      change === null
        ? current.filter((item) => item.id !== id)
        : current.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  }

  function runSearch(next: string) {
    const params = new URLSearchParams();
    if (next.trim()) params.set("q", next.trim());
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Diagrams</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDialog({ kind: "new", diagramKind: "whiteboard" })}>
            <Plus aria-hidden="true" />
            New whiteboard
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog({ kind: "new", diagramKind: "flow" })}
          >
            <Plus aria-hidden="true" />
            New flow
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog({ kind: "new", diagramKind: null })}
          >
            <LayoutTemplate aria-hidden="true" />
            New from template
          </Button>
        </div>
      </div>

      <form
        role="search"
        className="flex max-w-md items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch(search);
        }}
      >
        <label htmlFor={ids.search} className="sr-only">
          Search diagrams
        </label>
        <Input
          id={ids.search}
          type="search"
          value={search}
          maxLength={200}
          placeholder="Search titles and labels…"
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) runSearch("");
          }}
        />
        <Button type="submit" size="sm" variant="outline">
          <Search aria-hidden="true" />
          Search
        </Button>
      </form>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query
            ? `No diagram matches “${query}”.`
            : "No diagrams yet. Start a whiteboard or a flow, or pick a template."}
        </p>
      ) : (
        <DndContext
          id={ids.dnd}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
              {items.map((card, index) => (
                <SortableCard
                  key={card.id}
                  card={card}
                  projectKey={projectKey}
                  canReorder={canReorder}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                  onMove={(delta) => move(card.id, index + delta)}
                  onRename={() => setDialog({ kind: "rename", card })}
                  onDelete={() => setDialog({ kind: "delete", card })}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <NewDiagramDialog
        open={dialog?.kind === "new"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        projectKey={projectKey}
        kind={dialog?.kind === "new" ? dialog.diagramKind : "whiteboard"}
      />
      {dialog?.kind === "rename" ? (
        <RenameDiagramDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          diagram={dialog.card}
          onRenamed={(title) => patch(dialog.card.id, { title })}
          onFailed={() => patch(dialog.card.id, { title: dialog.card.title })}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <DeleteDiagramDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          diagram={dialog.card}
          onDeleted={() => {
            patch(dialog.card.id, null);
            setAnnouncement(`Deleted “${dialog.card.title}”`);
          }}
          onFailed={() => setItems(diagrams)}
        />
      ) : null}
    </div>
  );
}

function SortableCard({
  card,
  projectKey,
  canReorder,
  isFirst,
  isLast,
  onMove,
  onRename,
  onDelete,
}: {
  card: DiagramCard;
  projectKey: string;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: -1 | 1) => void;
  onRename: () => void;
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
  } = useSortable({ id: card.id, disabled: !canReorder });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border bg-card p-2 focus-within:ring-[3px] focus-within:ring-ring/50",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <Link
        href={diagramPath(projectKey, card.id)}
        className="flex flex-col gap-2 rounded-md outline-none"
      >
        <DiagramThumbnail
          diagramId={card.id}
          kind={card.kind}
          hasThumbnail={card.hasThumbnail}
          cacheKey={new Date(card.updatedAt).getTime()}
        />
        <span className="truncate px-1 text-sm font-medium">{card.title}</span>
      </Link>
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5">
          <DiagramKindIcon kind={card.kind} className="size-3" />
          {DIAGRAM_KIND_LABELS[card.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate">{card.ownerName ?? "No owner"}</span>
        <RelativeTime date={new Date(card.updatedAt)} />
      </div>
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        {canReorder ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${card.title} to reorder (or use the menu)`}
            className="cursor-grab rounded bg-background/90 p-1 shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${card.title}`}
              className="rounded bg-background/90 p-1 shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            {canReorder ? (
              <>
                <DropdownMenuItem disabled={isFirst} onSelect={() => onMove(-1)}>
                  <ArrowLeft aria-hidden="true" />
                  Move earlier
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isLast} onSelect={() => onMove(1)}>
                  <ArrowRight aria-hidden="true" />
                  Move later
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-destructive">
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
