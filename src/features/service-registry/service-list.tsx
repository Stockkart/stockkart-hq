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
  GitBranch,
  GripVertical,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  ShieldAlert,
  Siren,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { callAction } from "@/features/issue/client-utils";
import { NO_SECRETS_NOTICE, RECENT_INCIDENT_DAYS } from "@/lib/service-registry/constants";
import { STOCKKART_DEFAULT_SERVICES } from "@/lib/service-registry/defaults";
import { servicePath } from "@/lib/service-registry/slug";
import { type ServiceCard, type UserOption } from "@/lib/service-registry/views";
import { cn } from "@/lib/utils";
import { addDefaultServicesAction, moveServiceAction } from "@/server/actions/service-registry";

import { DeleteServiceDialog } from "./delete-service-dialog";
import { EnvironmentChips, QuickLinks, repoUrl } from "./service-bits";
import { ServiceFormDialog } from "./service-form-dialog";

/**
 * SVC-1 registry: service cards (name, runtime, repo, owner, environments, quick links,
 * recent incidents), "New service", "Add Stockkart defaults", drag to reorder with "Move
 * earlier/later" in each card's menu as the keyboard alternative, and delete. Moves and
 * deletes show at once and roll back if the server refuses.
 */
export function ServiceList({
  projectKey,
  services,
  users,
}: {
  projectKey: string;
  services: ServiceCard[];
  users: UserOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(services);
  const [seen, setSeen] = useState(services);
  if (seen !== services) {
    // The server re-rendered: its order is the truth.
    setSeen(services);
    setItems(services);
  }
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ServiceCard | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [addingDefaults, startDefaults] = useTransition();
  const [, startTransition] = useTransition();
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const missingDefaults = STOCKKART_DEFAULT_SERVICES.filter(
    (entry) => !items.some((item) => item.slug === entry.slug),
  );

  function move(id: string, to: number) {
    const from = items.findIndex((item) => item.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const previous = items;
    setItems(arrayMove(items, from, to));
    startTransition(async () => {
      const result = await callAction(() => moveServiceAction({ serviceId: id, index: to }));
      if (result === null) {
        setItems(previous);
        setAnnouncement("The service could not be moved");
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

  function addDefaults() {
    startDefaults(async () => {
      const result = await callAction(() => addDefaultServicesAction({ projectKey }));
      if (!result) return;
      toast.success(
        result.created.length > 0
          ? `Added ${result.created.join(", ")}. Add their URLs next.`
          : "The Stockkart defaults are already here.",
      );
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Services</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New service
          </Button>
          {missingDefaults.length > 0 ? (
            <Button size="sm" variant="outline" disabled={addingDefaults} onClick={addDefaults}>
              <PackagePlus aria-hidden="true" />
              Add Stockkart defaults
            </Button>
          ) : null}
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ShieldAlert aria-hidden="true" className="size-4 shrink-0 text-amber-600" />
        Where each service runs and where to look. {NO_SECRETS_NOTICE}
      </p>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No services yet. Add one, or start with the Stockkart defaults (names and repos only; you
          add the URLs).
        </p>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
              {items.map((card, index) => (
                <SortableServiceCard
                  key={card.id}
                  card={card}
                  projectKey={projectKey}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                  onMove={(delta) => move(card.id, index + delta)}
                  onEdit={() => router.push(`${servicePath(projectKey, card.slug)}?edit=1`)}
                  onDelete={() => setDeleting(card)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {creating ? (
        <ServiceFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setCreating(false);
          }}
          projectKey={projectKey}
          users={users}
        />
      ) : null}
      {deleting ? (
        <DeleteServiceDialog
          service={deleting}
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

function SortableServiceCard({
  card,
  projectKey,
  isFirst,
  isLast,
  onMove,
  onEdit,
  onDelete,
}: {
  card: ServiceCard;
  projectKey: string;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
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
  } = useSortable({ id: card.id });
  const repoHref = repoUrl(card.repo);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border bg-card p-3 focus-within:ring-[3px] focus-within:ring-ring/50",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-2 pr-16">
        <Link
          href={servicePath(projectKey, card.slug)}
          className="min-w-0 truncate font-medium outline-none hover:underline"
        >
          {card.name}
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">{card.runtime ?? "Runtime not set"}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {repoHref ? (
          <a
            href={repoHref}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <GitBranch aria-hidden="true" className="size-3.5" />
            {card.repo}
            <span className="sr-only"> (GitHub, opens in a new tab)</span>
          </a>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <UserRound aria-hidden="true" className="size-3.5" />
          {card.ownerName ?? "No owner"}
        </span>
        <Link
          href={`/${projectKey}/incidents?service=${encodeURIComponent(card.slug)}`}
          className={cn(
            "inline-flex items-center gap-1 hover:underline",
            card.recentIncidents > 0 && "text-amber-700 dark:text-amber-400",
          )}
          title={`Incidents in the last ${RECENT_INCIDENT_DAYS} days`}
        >
          <Siren aria-hidden="true" className="size-3.5" />
          {card.recentIncidents} {card.recentIncidents === 1 ? "incident" : "incidents"}
          <span className="sr-only"> in the last {RECENT_INCIDENT_DAYS} days</span>
        </Link>
      </div>
      <EnvironmentChips environments={card.environments} />
      <QuickLinks links={card.links} />
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${card.name} to reorder (or use the menu)`}
          className="cursor-grab rounded bg-background/90 p-1 shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${card.name}`}
              className="rounded bg-background/90 p-1 shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isFirst} onSelect={() => onMove(-1)}>
              <ArrowLeft aria-hidden="true" />
              Move earlier
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onSelect={() => onMove(1)}>
              <ArrowRight aria-hidden="true" />
              Move later
            </DropdownMenuItem>
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
