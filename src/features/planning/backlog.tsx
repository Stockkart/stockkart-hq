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
import { ChevronRight, GripVertical } from "lucide-react";
import Link from "next/link";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { callAction } from "@/features/issue/client-utils";
import { IssueTypeIcon } from "@/features/issue/issue-badges";
import { type FieldValue, useFieldSaver } from "@/features/issue/use-field-saver";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/issues/constants";
import { type BacklogGroup } from "@/lib/issues/filters";
import { type NamedOption, type PlanningIssue } from "@/lib/issues/views";
import { groupIssues } from "@/lib/planning/groups";
import {
  anchorInList,
  applyMove,
  availableMoves,
  dropOnto,
  moveBy,
  type MoveKind,
} from "@/lib/planning/reorder";
import { cn } from "@/lib/utils";
import { updateIssueFieldAction } from "@/server/actions/issues";
import { moveIssueAction } from "@/server/actions/planning";

import { MoveMenu } from "./move-menu";
import { NAV_ITEM, NAV_LINK, useListNavigation } from "./use-list-navigation";

interface BacklogProps {
  issues: PlanningIssue[];
  projectKey: string;
  group: BacklogGroup;
  users: NamedOption[];
  /** Filters hide rows; a drag then only reorders among the visible ones (still correct). */
  filtered: boolean;
}

/**
 * BLG-1/2/4 backlog: rank order, drag (or "Move to…" menu) to reorder within a section,
 * collapsible sections with point totals, inline priority/assignee/points.
 *
 * Reorders are optimistic (`useOptimistic`): the row moves at once; the server action
 * revalidates the page, and the new server order arrives in the same transition. If the
 * action fails, the transition ends without new data and the list falls back to the
 * server order: the rollback.
 */
export function Backlog({ issues, projectKey, group, users, filtered }: BacklogProps) {
  const [optimistic, applyOptimistic] = useOptimistic(
    issues,
    (state, move: { id: string; afterId: string | null }) =>
      applyMove(state, move.id, move.afterId),
  );
  const [, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const dndId = useId();
  useListNavigation(container);
  const sensors = useSensors(
    // A small distance, so clicking the handle (or its menu) does not start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sections = groupIssues(optimistic, group);
  const fullIds = optimistic.map((issue) => issue.id);
  const keyOf = new Map(optimistic.map((issue) => [issue.id, issue.key]));

  function move(id: string, afterId: string | null, description: string) {
    startTransition(async () => {
      applyOptimistic({ id, afterId });
      const result = await callAction(() =>
        moveIssueAction({ issueId: id, afterIssueId: afterId }),
      );
      setAnnouncement(result ? description : `Could not move ${keyOf.get(id) ?? "the issue"}`);
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const section = sections.find((s) => s.issues.some((issue) => issue.id === active.id));
    // Sections are views of one ranked list; dropping into another section would also
    // change its epic/component/assignee, which a reorder must not do.
    if (!section?.issues.some((issue) => issue.id === over.id)) return;
    const reorder = dropOnto(
      section.issues.map((issue) => issue.id),
      String(active.id),
      String(over.id),
    );
    if (reorder) {
      const id = String(active.id);
      move(id, anchorInList(fullIds, reorder, id), `Moved ${keyOf.get(id)}`);
    }
  }

  function onMenuMove(sectionIds: string[], id: string, kind: MoveKind) {
    const reorder = moveBy(sectionIds, id, kind);
    if (!reorder) return;
    const position = reorder.order.indexOf(id) + 1;
    move(
      id,
      anchorInList(fullIds, reorder, id),
      `Moved ${keyOf.get(id)} to position ${position} of ${sectionIds.length}`,
    );
  }

  if (optimistic.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="font-medium">
          {filtered ? "No issues match these filters" : "The backlog is empty"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered ? (
            "Change or clear the filters above."
          ) : (
            <>
              Press <kbd className="rounded border px-1 font-mono text-xs">C</kbd> to create an
              issue; new issues start at the top.
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <div ref={container} className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.id);
          const listId = `${dndId}-${section.id}`;
          const ids = section.issues.map((issue) => issue.id);
          return (
            <section key={section.id} aria-label={section.label} className="rounded-lg border">
              <h2 className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  aria-controls={listId}
                  className="flex flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(section.id)) next.delete(section.id);
                      else next.add(section.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={cn("size-4 transition-transform", !isCollapsed && "rotate-90")}
                  />
                  <span className="truncate">{section.label}</span>
                  <span className="font-normal text-muted-foreground">
                    {section.issues.length} {section.issues.length === 1 ? "issue" : "issues"}
                  </span>
                </button>
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {section.points} pts
                </span>
              </h2>
              <ul id={listId} hidden={isCollapsed} className="divide-y">
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {section.issues.map((issue, index) => (
                    <BacklogRow
                      key={issue.id}
                      issue={issue}
                      projectKey={projectKey}
                      users={users}
                      available={availableMoves(index, ids.length)}
                      onMove={(kind) => onMenuMove(ids, issue.id, kind)}
                    />
                  ))}
                </SortableContext>
              </ul>
            </section>
          );
        })}
      </DndContext>
    </div>
  );
}

type RowField = "priority" | "assignee" | "storyPoints";

function BacklogRow({
  issue,
  projectKey,
  users,
  available,
  onMove,
}: {
  issue: PlanningIssue;
  projectKey: string;
  users: NamedOption[];
  available: Record<MoveKind, boolean>;
  onMove: (kind: MoveKind) => void;
}) {
  // Destructured: the React Compiler lint treats the hook's result object as a ref.
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: issue.id });
  // BLG-4 inline edits go through the same updateIssueField (and activity) as the detail page.
  const saver = useFieldSaver<RowField>(
    {
      priority: issue.priority,
      assignee: issue.assignee?.id ?? null,
      storyPoints: issue.storyPoints,
    },
    async (field, value) =>
      (await callAction(() => updateIssueFieldAction({ issueId: issue.id, field, value }))) !==
      null,
  );
  const [pointsDraft, setPointsDraft] = useState<string | null>(null);
  const href = `/${projectKey}/issues/${issue.key}`;
  const points = saver.valueOf("storyPoints");

  function commitPoints() {
    if (pointsDraft === null) return;
    const trimmed = pointsDraft.trim();
    const value: FieldValue = trimmed === "" ? null : Number(trimmed);
    setPointsDraft(null);
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 999)) return;
    if (value !== points) saver.change("storyPoints", value, { immediate: true });
  }

  return (
    <li
      ref={setNodeRef}
      {...NAV_ITEM}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
      className={cn(
        "flex items-center gap-2 bg-background px-2 py-1.5 text-sm focus-within:bg-muted/60 hover:bg-muted/40",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${issue.key} (space to pick up, arrows to move, space to drop)`}
        className="cursor-grab touch-none rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <IssueTypeIcon type={issue.type} />
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{issue.key}</span>
      <Link
        href={href}
        {...NAV_LINK}
        className="min-w-0 flex-1 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="sr-only">{issue.key}: </span>
        {issue.title}
      </Link>
      <NativeSelect
        aria-label={`Priority of ${issue.key}`}
        className="w-20"
        value={String(saver.valueOf("priority"))}
        onChange={(event) => {
          const next = PRIORITIES.find((p) => String(p) === event.target.value);
          if (next !== undefined) saver.change("priority", next);
        }}
        onBlur={() => saver.flush("priority")}
      >
        {PRIORITIES.map((value) => (
          <option key={value} value={value} title={PRIORITY_LABELS[value]}>
            P{value}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label={`Assignee of ${issue.key}`}
        className="w-36"
        value={String(saver.valueOf("assignee") ?? "")}
        onChange={(event) => saver.change("assignee", event.target.value || null)}
        onBlur={() => saver.flush("assignee")}
      >
        <option value="">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </NativeSelect>
      <input
        aria-label={`Story points of ${issue.key}`}
        inputMode="numeric"
        placeholder="–"
        className="h-8 w-12 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        value={pointsDraft ?? (points === null ? "" : String(points))}
        onChange={(event) => setPointsDraft(event.target.value)}
        onBlur={commitPoints}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitPoints();
          if (event.key === "Escape") setPointsDraft(null);
        }}
      />
      <MoveMenu itemLabel={issue.key} available={available} onMove={onMove} />
    </li>
  );
}
