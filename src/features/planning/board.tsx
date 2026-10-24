"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRightLeft, ChevronDown, Columns3, GripVertical, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MultiSelect } from "@/components/ui/select";
import { typeOptions } from "@/features/issue/field-options";
import { callAction } from "@/features/issue/client-utils";
import { Avatar, IssueTypeIcon, PriorityLabel, StatusBadge } from "@/features/issue/issue-badges";
import { ISSUE_TYPES } from "@/lib/issues/constants";
import { type PlanningIssue, type StatusOption } from "@/lib/issues/views";
import { boardLayout } from "@/lib/planning/board-view";
import { isFull, wipState } from "@/lib/planning/wip";
import { type BoardScope } from "@/lib/sprints/constants";
import { cn } from "@/lib/utils";
import {
  boardViewQuery,
  normaliseView,
  type ResolvedView,
  sameView,
  viewDefaultsOf,
} from "@/lib/views/view-defaults";
import { updateIssueFieldAction } from "@/server/actions/issues";
import { saveViewDefaultsAction } from "@/server/actions/settings";

interface BoardProps {
  issues: PlanningIssue[];
  statuses: StatusOption[];
  projectKey: string;
  /** BRD-3 scope, kept in the URL next to the view params. */
  scope: BoardScope;
  /** BRD-6: the view the URL asks for (types, hidden columns), normalised. */
  view: ResolvedView;
  /** The project's board defaults, normalised (what the plain URL shows). */
  defaults: ResolvedView;
}

/** The pointer's column first; with the keyboard (no pointer), the overlapped one. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * BRD-1/2 Kanban board: one column per status (in workflow order), cards in rank order.
 * Dragging a card to another column (or its "Move to…" menu, the keyboard alternative)
 * changes the status through `updateIssueField`, so it lands in activity and sets
 * `resolved_at` like any other edit. Optimistic with rollback, as in the backlog.
 *
 * BRD-6: a type filter and hideable columns, in the URL (`types=`, `hide=`; the plain URL
 * shows the project defaults). The page loads every issue of the scope, so a view change
 * filters here at once while the URL updates. Hidden columns are no drop targets, but
 * "Move to…" still lists every status, so no card is ever stuck; a note counts the cards in
 * hidden columns and offers to show them.
 */
export function Board({ issues, statuses, projectKey, scope, view, defaults }: BoardProps) {
  const [optimistic, applyOptimistic] = useOptimistic(
    issues,
    (state, move: { id: string; status: StatusOption }) =>
      state.map((issue) => (issue.id === move.id ? { ...issue, status: move.status } : issue)),
  );
  const [, startTransition] = useTransition();
  const [shownView, setShownView] = useOptimistic(view);
  const [, startViewTransition] = useTransition();
  const [saving, startSaving] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const statusIds = statuses.map((status) => status.id);
  // Quick successive toggles build on the latest view, not this render's (possibly stale).
  const latestView = useRef(view);
  useEffect(() => {
    latestView.current = view;
  }, [view]);
  const [announcement, setAnnouncement] = useState("");
  // A moved card remounts in its new column, which drops keyboard focus; the card with
  // this id takes focus (its "Move to…" button) whenever it mounts, so the keyboard user
  // stays on it after a move or a rollback.
  const [focusId, setFocusId] = useState<string | null>(null);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const { columns, typed, hiddenCount } = boardLayout(optimistic, statuses, shownView);
  const hiddenIds = new Set(shownView.hidden);
  const scopeParam = { scope: scope === "all" ? "all" : undefined };

  function changeView(change: (current: ResolvedView) => Partial<ResolvedView>) {
    const current = latestView.current;
    const next = normaliseView({ ...current, ...change(current) }, statusIds);
    latestView.current = next;
    const query = boardViewQuery(next, defaults, scopeParam).toString();
    startViewTransition(() => {
      setShownView(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function saveAsDefault() {
    const saved = shownView;
    startSaving(async () => {
      const ok =
        (await callAction(() =>
          saveViewDefaultsAction({ projectKey, board: viewDefaultsOf(saved) }),
        )) !== null;
      if (!ok) return;
      toast.success("Saved as the board's default view");
      // The view is the default now, so the plain URL shows it.
      const query = boardViewQuery(saved, saved, scopeParam).toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function moveTo(issue: PlanningIssue, status: StatusOption, keepFocus = false) {
    if (issue.status.id === status.id) return;
    if (keepFocus) setFocusId(issue.id);
    // BRD-5: a full column still takes the card, with a warning. Counts the cards the
    // column shows (the type filter applies), as its header does.
    const inTarget = typed.filter((row) => row.status.id === status.id).length;
    if (isFull(inTarget, status.wipLimit)) {
      toast.warning(`${status.name} is over its WIP limit`, {
        description: `${inTarget + 1} issues, limit ${status.wipLimit}.`,
      });
    }
    const hiddenTarget = hiddenIds.has(status.id);
    startTransition(async () => {
      applyOptimistic({ id: issue.id, status });
      const result = await callAction(() =>
        updateIssueFieldAction({ issueId: issue.id, field: "status", value: status.id }),
      );
      setAnnouncement(
        result
          ? `Moved ${issue.key} to ${status.name}${hiddenTarget ? " (a hidden column)" : ""}`
          : `Could not move ${issue.key}`,
      );
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const issue = optimistic.find((row) => row.id === event.active.id);
    // Only shown columns are drop targets.
    const status = columns.find((row) => row.id === event.over?.id);
    if (issue && status) moveTo(issue, status);
  }

  const isDefault = sameView(shownView, defaults);

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div role="toolbar" aria-label="Board view" className="flex flex-wrap items-center gap-2">
        <TypeFilter
          selected={shownView.types}
          onToggle={(type, on) =>
            changeView((current) => ({
              types: on ? [...current.types, type] : current.types.filter((t) => t !== type),
            }))
          }
        />
        <ColumnsMenu
          statuses={statuses}
          hidden={shownView.hidden}
          onToggle={(statusId, shown) =>
            changeView((current) => ({
              hidden: shown
                ? current.hidden.filter((id) => id !== statusId)
                : [...current.hidden, statusId],
            }))
          }
          onShowAll={() => changeView(() => ({ hidden: [] }))}
        />
        {!isDefault ? (
          <>
            <Button variant="outline" size="sm" disabled={saving} onClick={saveAsDefault}>
              <Save aria-hidden="true" />
              Save as default
            </Button>
            <Button variant="ghost" size="sm" onClick={() => changeView(() => defaults)}>
              <RotateCcw aria-hidden="true" />
              Reset to default
            </Button>
          </>
        ) : null}
        {shownView.hidden.length > 0 ? (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            {hiddenCount} {hiddenCount === 1 ? "issue" : "issues"} in hidden columns ·
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => changeView(() => ({ hidden: [] }))}
            >
              Show
            </Button>
          </p>
        ) : null}
      </div>
      <DndContext id={dndId} sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((status) => {
            const cards = typed.filter((issue) => issue.status.id === status.id);
            return (
              <Column key={status.id} status={status} count={cards.length}>
                {cards.map((issue) => (
                  <Card
                    key={issue.id}
                    issue={issue}
                    projectKey={projectKey}
                    // Every status, hidden columns included, so nothing gets stuck.
                    statuses={statuses}
                    takeFocus={focusId === issue.id}
                    onMove={(next) => moveTo(issue, next, true)}
                  />
                ))}
              </Column>
            );
          })}
        </div>
      </DndContext>
    </>
  );
}

/** BRD-6 type filter: any of the picked types; none picked = every type. */
function TypeFilter({
  selected,
  onToggle,
}: {
  selected: PlanningIssue["type"][];
  onToggle: (type: PlanningIssue["type"], on: boolean) => void;
}) {
  const options = typeOptions(ISSUE_TYPES);
  const names = options.filter((option) => selected.includes(option.value)).map((o) => o.label);
  return (
    <MultiSelect
      variant="chip"
      label="Type"
      aria-label={selected.length > 0 ? `Type: ${names.join(", ")}` : "Type: all types"}
      className={selected.length > 0 ? "border-transparent bg-secondary" : undefined}
      value={selected}
      options={options}
      onChange={(_next, change) => onToggle(change.value, change.selected)}
    >
      {() => (
        <>
          {selected.length > 0 ? `Type: ${names.join(", ")}` : "All types"}
          <ChevronDown aria-hidden="true" />
        </>
      )}
    </MultiSelect>
  );
}

/** BRD-6 "Columns": show or hide each status column; the last shown one stays. */
function ColumnsMenu({
  statuses,
  hidden,
  onToggle,
  onShowAll,
}: {
  statuses: StatusOption[];
  hidden: string[];
  onToggle: (statusId: string, shown: boolean) => void;
  onShowAll: () => void;
}) {
  const shownCount = statuses.length - hidden.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={hidden.length > 0 ? "border-transparent bg-secondary" : undefined}
        >
          <Columns3 aria-hidden="true" />
          Columns
          {hidden.length > 0 ? (
            <span className="rounded bg-background px-1 text-xs tabular-nums">
              {hidden.length} hidden
            </span>
          ) : null}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Columns shown</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {statuses.map((status) => {
          const shown = !hidden.includes(status.id);
          return (
            <DropdownMenuCheckboxItem
              key={status.id}
              checked={shown}
              // At least one column stays visible.
              disabled={shown && shownCount <= 1}
              // Keep the menu open while toggling several columns.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => onToggle(status.id, checked)}
            >
              {status.name}
            </DropdownMenuCheckboxItem>
          );
        })}
        {hidden.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onShowAll}>Show all columns</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Column({
  status,
  count,
  children,
}: {
  status: StatusOption;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const headingId = useId();
  const wip = wipState(count, status.wipLimit);
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30",
        // BRD-5: amber when over the WIP limit (the badge says it in text too).
        wip.over && "border-amber-500 bg-amber-50 dark:border-amber-400 dark:bg-amber-950/40",
        isOver && "ring-2 ring-ring/50",
      )}
    >
      <h2 id={headingId} className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <StatusBadge name={status.name} category={status.category} />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {wip.over ? (
            <span className="rounded bg-amber-200 px-1.5 py-0.5 font-medium text-amber-950 dark:bg-amber-400/25 dark:text-amber-100">
              Over WIP limit
            </span>
          ) : null}
          <span aria-hidden="true">{wip.label}</span>
          <span className="sr-only">{wip.description}</span>
        </span>
      </h2>
      <ul className="flex min-h-24 flex-col gap-2 p-2">{children}</ul>
    </section>
  );
}

function Card({
  issue,
  projectKey,
  statuses,
  takeFocus,
  onMove,
}: {
  issue: PlanningIssue;
  projectKey: string;
  statuses: StatusOption[];
  takeFocus: boolean;
  onMove: (status: StatusOption) => void;
}) {
  // Destructured: the React Compiler lint treats the hook's result object as a ref.
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform } =
    useDraggable({ id: issue.id });
  const moveButton = useRef<HTMLButtonElement>(null);
  // Set when a "Move to…" item was chosen: the menu must not return focus to this (old)
  // card, which is about to remount elsewhere and take focus itself.
  const moved = useRef(false);
  useEffect(() => {
    if (takeFocus) moveButton.current?.focus();
  }, [takeFocus]);
  const href = `/${projectKey}/issues/${issue.key}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-background p-2.5 text-sm shadow-xs",
        isDragging && "relative z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${issue.key} to another column`}
          className="cursor-grab touch-none rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <IssueTypeIcon type={issue.type} />
        <span className="font-mono text-xs text-muted-foreground">{issue.key}</span>
        <span className="ml-auto">
          <PriorityLabel priority={issue.priority} short />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={moveButton}
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Move ${issue.key} to…`}
            >
              <ArrowRightLeft aria-hidden="true" className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!moved.current) return;
              moved.current = false;
              event.preventDefault();
            }}
          >
            <DropdownMenuLabel>Move to…</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {statuses.map((status) => (
              <DropdownMenuItem
                key={status.id}
                disabled={status.id === issue.status.id}
                onSelect={() => {
                  moved.current = true;
                  onMove(status);
                }}
              >
                {status.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Link
        href={href}
        className="line-clamp-3 rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="sr-only">{issue.key}: </span>
        {issue.title}
      </Link>
      {issue.labels.length > 0 ? (
        <ul aria-label="Labels" className="flex flex-wrap gap-1">
          {issue.labels.map((label) => (
            <li key={label.id} className="rounded-full border px-1.5 text-xs text-muted-foreground">
              {label.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {issue.assignee ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={issue.assignee.name} />
            <span className="sr-only">Assigned to {issue.assignee.name}</span>
          </span>
        ) : (
          <span>Unassigned</span>
        )}
        {issue.storyPoints !== null ? (
          <span className="rounded bg-muted px-1.5 tabular-nums">
            {issue.storyPoints}
            <span className="sr-only"> points</span>
          </span>
        ) : null}
      </div>
    </li>
  );
}
