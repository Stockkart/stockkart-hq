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
import { ArrowRightLeft, GripVertical } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { callAction } from "@/features/issue/client-utils";
import { Avatar, IssueTypeIcon, PriorityLabel, StatusBadge } from "@/features/issue/issue-badges";
import { type PlanningIssue, type StatusOption } from "@/lib/issues/views";
import { cn } from "@/lib/utils";
import { updateIssueFieldAction } from "@/server/actions/issues";

interface BoardProps {
  issues: PlanningIssue[];
  statuses: StatusOption[];
  projectKey: string;
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
 */
export function Board({ issues, statuses, projectKey }: BoardProps) {
  const [optimistic, applyOptimistic] = useOptimistic(
    issues,
    (state, move: { id: string; status: StatusOption }) =>
      state.map((issue) => (issue.id === move.id ? { ...issue, status: move.status } : issue)),
  );
  const [, startTransition] = useTransition();
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

  function moveTo(issue: PlanningIssue, status: StatusOption, keepFocus = false) {
    if (issue.status.id === status.id) return;
    if (keepFocus) setFocusId(issue.id);
    startTransition(async () => {
      applyOptimistic({ id: issue.id, status });
      const result = await callAction(() =>
        updateIssueFieldAction({ issueId: issue.id, field: "status", value: status.id }),
      );
      setAnnouncement(
        result ? `Moved ${issue.key} to ${status.name}` : `Could not move ${issue.key}`,
      );
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const issue = optimistic.find((row) => row.id === event.active.id);
    const status = statuses.find((row) => row.id === event.over?.id);
    if (issue && status) moveTo(issue, status);
  }

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <DndContext id={dndId} sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {statuses.map((status) => {
            const cards = optimistic.filter((issue) => issue.status.id === status.id);
            return (
              <Column key={status.id} status={status} count={cards.length}>
                {cards.map((issue) => (
                  <Card
                    key={issue.id}
                    issue={issue}
                    projectKey={projectKey}
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
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30",
        isOver && "ring-2 ring-ring/50",
      )}
    >
      <h2 id={headingId} className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <StatusBadge name={status.name} category={status.category} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
          <span className="sr-only"> {count === 1 ? "issue" : "issues"}</span>
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
