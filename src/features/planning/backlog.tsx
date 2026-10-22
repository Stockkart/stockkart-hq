"use client";

import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
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
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { applyBulkChange, type BulkLookups } from "@/features/bulk/apply";
import { BulkBar, type BulkOptions } from "@/features/bulk/bulk-bar";
import { RowCheckbox, SelectAllCheckbox } from "@/features/bulk/checkboxes";
import { selectRowProps, useRowSelection, useSelectShortcut } from "@/features/bulk/use-selection";
import { callAction } from "@/features/issue/client-utils";
import { priorityOptions, userOptions } from "@/features/issue/field-options";
import { IssueTypeIcon } from "@/features/issue/issue-badges";
import { type FieldValue, useFieldSaver } from "@/features/issue/use-field-saver";
import {
  CreateSprintButton,
  SprintActions,
  type SprintContext,
} from "@/features/sprints/sprint-actions";
import { applySprintChange, issueMoveOf, type SprintChange } from "@/features/sprints/sprint-state";
import { type BulkChange } from "@/lib/issues/bulk";
import { PRIORITIES } from "@/lib/issues/constants";
import { type BacklogGroup } from "@/lib/issues/filters";
import { type NamedOption, type PlanningIssue } from "@/lib/issues/views";
import {
  anchorInList,
  applyMove,
  availableMoves,
  dropOnto,
  moveBy,
  type MoveKind,
} from "@/lib/planning/reorder";
import {
  BACKLOG_CONTAINER,
  type PlanningSection,
  planningSections,
} from "@/lib/planning/sprint-sections";
import { formatDateRange } from "@/lib/sprints/dates";
import { type SprintSummary } from "@/lib/sprints/views";
import { cn } from "@/lib/utils";
import { bulkEditIssuesAction } from "@/server/actions/bulk";
import { updateIssueFieldAction } from "@/server/actions/issues";
import { moveIssueAction } from "@/server/actions/planning";
import { moveIssueToSprintAction } from "@/server/actions/sprints";

import { MoveMenu } from "./move-menu";
import { NAV_ITEM, NAV_LINK, useListNavigation } from "./use-list-navigation";

interface BacklogProps {
  issues: PlanningIssue[];
  /** Every sprint of the project; the active and planned ones get sections (BLG-3). */
  sprints: SprintSummary[];
  projectKey: string;
  sprintLengthDays: number;
  /** "Create sprint" dialog defaults, worked out on the server. */
  sprintDefaults: { name: string; startDate: string; endDate: string };
  group: BacklogGroup;
  users: NamedOption[];
  /** Filters hide rows; a drag then only reorders among the visible ones (still correct). */
  filtered: boolean;
  /** ISS-12 bulk bar pickers (the page's project options). */
  bulkOptions: BulkOptions;
}

/** Optimistic state of the whole page: the ranked issues and the sprints. */
interface PlanningState {
  issues: PlanningIssue[];
  sprints: SprintSummary[];
}

type PlanningUpdate =
  /** `afterId` undefined: keep the rank. `sprintId` undefined: keep the sprint. */
  | { kind: "move"; id: string; afterId?: string | null; sprintId?: string | null }
  | { kind: "sprint"; change: SprintChange }
  /** ISS-12: one bulk change to the selected issues. */
  | { kind: "bulk"; ids: ReadonlySet<string>; change: BulkChange };

function reduce(state: PlanningState, update: PlanningUpdate, lookups: BulkLookups): PlanningState {
  if (update.kind === "bulk") {
    return {
      sprints: state.sprints,
      issues: applyBulkChange(state.issues, update.ids, update.change, lookups),
    };
  }
  if (update.kind === "move") {
    const moved =
      update.afterId === undefined
        ? state.issues
        : applyMove(state.issues, update.id, update.afterId);
    const { sprintId } = update;
    return {
      sprints: state.sprints,
      issues:
        sprintId === undefined
          ? moved
          : moved.map((issue) => (issue.id === update.id ? { ...issue, sprintId } : issue)),
    };
  }
  const move = issueMoveOf(update.change);
  return {
    sprints: applySprintChange(state.sprints, update.change),
    issues: move
      ? state.issues.map((issue) =>
          issue.sprintId === move.from && (!move.openOnly || issue.status.category !== "done")
            ? { ...issue, sprintId: move.to }
            : issue,
        )
      : state.issues,
  };
}

const DROP_PREFIX = "drop:";

/**
 * Pointer: the row under the pointer, else the section under it (an empty sprint). Keyboard
 * (no pointer): the closest row.
 */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const rows = hits.filter((hit) => !String(hit.id).startsWith(DROP_PREFIX));
  if (rows.length > 0) return rows;
  return hits.length > 0 ? hits : closestCenter(args);
};

const pts = (value: number) => `${value} ${value === 1 ? "pt" : "pts"}`;

/**
 * BLG-1…4 backlog with BLG-3 sprint sections: the active sprint and each planned sprint
 * above the backlog, each collapsible with its dates, goal, points and Start/Complete.
 * Drag (or the row menu, the keyboard alternative) reorders within a section or moves an
 * issue into another sprint or the backlog; ranks stay one project-wide order, so every
 * section stays in rank order.
 *
 * Every change is optimistic (`useOptimistic`): it shows at once; the server action
 * revalidates the page and the server state arrives in the same transition. If the action
 * fails, the transition ends without new data and the page falls back: the rollback.
 */
export function Backlog({
  issues,
  sprints,
  projectKey,
  sprintLengthDays,
  sprintDefaults,
  group,
  users,
  filtered,
  bulkOptions,
}: BacklogProps) {
  const [state, applyUpdate] = useOptimistic<PlanningState, PlanningUpdate>(
    { issues, sprints },
    (current, update) => reduce(current, update, bulkOptions),
  );
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  // A row moved by the menu to another section remounts there and takes focus on mount;
  // only in its new section (`container`), and only once.
  const [focus, setFocus] = useState<{ id: string; container: string } | null>(null);
  const clearFocus = useCallback(() => setFocus(null), []);
  const container = useRef<HTMLDivElement>(null);
  const dndId = useId();
  useListNavigation(container);
  const sensors = useSensors(
    // A small distance, so clicking the handle (or its menu) does not start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sections = planningSections(state.issues, state.sprints, group);
  // ISS-12: rows in collapsed sections are not visible, so they are not selectable.
  const selection = useRowSelection(
    sections
      .filter((section) => !collapsed.has(section.id))
      .flatMap((section) => section.issues.map((issue) => issue.id)),
  );
  useSelectShortcut(container, (id) => selection.toggle(id));
  const fullIds = state.issues.map((issue) => issue.id);
  const keyOf = new Map(state.issues.map((issue) => [issue.id, issue.key]));
  const sectionOf = (issueId: string) =>
    sections.find((section) => section.issues.some((issue) => issue.id === issueId));
  const targets = sections
    // A sprint still being created (optimistic `new:` id) takes no issues yet.
    .filter((section) => section.sprint !== null && !section.sprint.id.startsWith("new:"))
    .map((section) => ({ container: section.container, label: section.label }));
  const context: SprintContext = {
    projectKey,
    sprintLengthDays,
    sprints: state.sprints,
    newSprintName: `Sprint ${state.sprints.length + 1}`,
  };

  function reorder(id: string, afterId: string | null, description: string) {
    startTransition(async () => {
      applyUpdate({ kind: "move", id, afterId });
      const result = await callAction(() =>
        moveIssueAction({ issueId: id, afterIssueId: afterId }),
      );
      setAnnouncement(result ? description : `Could not move ${keyOf.get(id) ?? "the issue"}`);
    });
  }

  /** BLG-3: into a sprint (or the backlog: `BACKLOG_CONTAINER`). */
  function moveToContainer(id: string, target: string, afterId?: string | null) {
    const sprintId = target === BACKLOG_CONTAINER ? null : target;
    const label = targets.find((item) => item.container === target)?.label ?? "the backlog";
    startTransition(async () => {
      applyUpdate({ kind: "move", id, afterId, sprintId });
      const result = await callAction(() =>
        moveIssueToSprintAction(
          afterId === undefined
            ? { issueId: id, sprintId }
            : { issueId: id, sprintId, afterIssueId: afterId },
        ),
      );
      setAnnouncement(
        result
          ? `Moved ${keyOf.get(id)} to ${label}`
          : `Could not move ${keyOf.get(id) ?? "the issue"}`,
      );
    });
  }

  function runBulk(change: BulkChange, description: string) {
    const ids = selection.selectedIds;
    startTransition(async () => {
      applyUpdate({ kind: "bulk", ids: new Set(ids), change });
      const result = await callAction(() =>
        bulkEditIssuesAction({ projectKey, issueIds: ids, change }),
      );
      setAnnouncement(result ? description : "The bulk edit was not saved");
      if (result && change.kind === "delete") selection.clear();
    });
  }

  function onSprintChange(change: SprintChange) {
    applyUpdate({ kind: "sprint", change });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    const source = sectionOf(id);
    const overSection = overId.startsWith(DROP_PREFIX)
      ? sections.find((section) => `${DROP_PREFIX}${section.id}` === overId)
      : sectionOf(overId);
    if (!source || !overSection) return;
    if (overSection.container.startsWith("new:")) return;
    const overRow = overId.startsWith(DROP_PREFIX) ? null : overId;

    if (overSection.id === source.id) {
      if (!overRow || overRow === id) return;
      const result = dropOnto(
        source.issues.map((issue) => issue.id),
        id,
        overRow,
      );
      if (result) reorder(id, anchorInList(fullIds, result, id), `Moved ${keyOf.get(id)}`);
      return;
    }
    // Backlog groups are views of one list; dropping into another group would also change
    // its epic/component/assignee, which a move must not do.
    if (overSection.container === source.container) return;
    if (!overRow) {
      moveToContainer(id, overSection.container);
      return;
    }
    // Dropped onto a row of another section: take that row's place there.
    const ids = overSection.issues.map((issue) => issue.id);
    const at = ids.indexOf(overRow);
    const order = [...ids];
    order.splice(at, 0, id);
    const afterId = anchorInList(
      fullIds,
      { order, afterId: at > 0 ? (ids[at - 1] ?? null) : null },
      id,
    );
    moveToContainer(id, overSection.container, afterId);
  }

  function onMenuMove(sectionIds: string[], id: string, kind: MoveKind) {
    const result = moveBy(sectionIds, id, kind);
    if (!result) return;
    const position = result.order.indexOf(id) + 1;
    reorder(
      id,
      anchorInList(fullIds, result, id),
      `Moved ${keyOf.get(id)} to position ${position} of ${sectionIds.length}`,
    );
  }

  const backlogCount = sections
    .filter((section) => section.sprint === null)
    .reduce((count, section) => count + section.issues.length, 0);

  return (
    <div ref={container} className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 pl-3 text-sm text-muted-foreground">
          <SelectAllCheckbox
            label="Select all shown issues"
            all={selection.allSelected}
            some={selection.someSelected}
            onChange={(all) => (all ? selection.selectAll() : selection.clear())}
          />
          <span aria-hidden="true">Select all</span>
        </label>
        <CreateSprintButton context={context} defaults={sprintDefaults} onChange={onSprintChange} />
      </div>
      {/* Before the sections, so it is a few Tab stops away, not one per row (§9.5). */}
      <BulkBar
        count={selection.selectedIds.length}
        visibleCount={sections
          .filter((section) => !collapsed.has(section.id))
          .reduce((count, section) => count + section.issues.length, 0)}
        options={bulkOptions}
        pending={pending}
        onApply={runBulk}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
      />
      <DndContext id={dndId} sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}>
        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.id);
          const ids = section.issues.map((issue) => issue.id);
          const isBacklog = section.sprint === null;
          return (
            <PlanningSectionView
              key={section.id}
              section={section}
              listId={`${dndId}-${section.id}`}
              collapsed={isCollapsed}
              filtered={filtered}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })
              }
              actions={
                section.sprint ? (
                  <SprintActions
                    sprint={section.sprint}
                    context={context}
                    onChange={onSprintChange}
                  />
                ) : null
              }
              empty={
                isBacklog && backlogCount === 0 ? (
                  <EmptyBacklog filtered={filtered} />
                ) : (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    Drag issues here, or use “Move to sprint…” in a row’s menu.
                  </p>
                )
              }
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {section.issues.map((issue, index) => (
                  <BacklogRow
                    key={issue.id}
                    issue={issue}
                    projectKey={projectKey}
                    users={users}
                    selected={selection.isSelected(issue.id)}
                    onSelect={(range) => selection.toggle(issue.id, range)}
                    available={availableMoves(index, ids.length)}
                    onMove={(kind) => onMenuMove(ids, issue.id, kind)}
                    takeFocus={focus?.id === issue.id && focus.container === section.container}
                    onFocused={clearFocus}
                    moveTargets={[
                      ...targets,
                      { container: BACKLOG_CONTAINER, label: "Backlog" },
                    ].filter((target) => target.container !== section.container)}
                    onMoveTo={(target) => {
                      setFocus({ id: issue.id, container: target });
                      moveToContainer(issue.id, target);
                    }}
                  />
                ))}
              </SortableContext>
            </PlanningSectionView>
          );
        })}
      </DndContext>
    </div>
  );
}

function EmptyBacklog({ filtered }: { filtered: boolean }) {
  return (
    <div className="p-6 text-center">
      <h3 className="font-medium">
        {filtered ? "No issues match these filters" : "The backlog is empty"}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {filtered ? (
          "Change or clear the filters above."
        ) : (
          <>
            Press <kbd className="rounded border px-1 font-mono text-xs">C</kbd> to create an issue;
            new issues start at the top.
          </>
        )}
      </p>
    </div>
  );
}

/** A collapsible section: a sprint (dates, goal, points, actions) or a backlog group. */
function PlanningSectionView({
  section,
  listId,
  collapsed,
  filtered,
  onToggle,
  actions,
  empty,
  children,
}: {
  section: PlanningSection;
  listId: string;
  collapsed: boolean;
  /** Filters hide rows, so counts and points cover only the shown ones. */
  filtered: boolean;
  onToggle: () => void;
  actions: ReactNode;
  empty: ReactNode;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${DROP_PREFIX}${section.id}`,
    disabled: section.id.startsWith("new:"),
  });
  const { sprint } = section;
  const count = section.issues.length;
  return (
    <section
      aria-label={sprint ? sprint.name : section.label}
      className={cn("rounded-lg border", isOver && "ring-2 ring-ring/50")}
    >
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 font-medium">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={listId}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={onToggle}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn("size-4 shrink-0 transition-transform", !collapsed && "rotate-90")}
            />
            <span className="truncate">{section.label}</span>
            {sprint ? (
              <span className="shrink-0 font-normal text-muted-foreground">
                {sprint.state === "active" ? "Active · " : null}
                {formatDateRange(sprint.startDate, sprint.endDate)}
              </span>
            ) : null}
            <span className="shrink-0 font-normal text-muted-foreground">
              {count} {count === 1 ? "issue" : "issues"}
              {filtered ? " (filtered)" : null}
            </span>
          </button>
        </h2>
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {pts(section.points)}
        </span>
        {actions}
        {sprint?.goal ? (
          <p className="basis-full pl-6 text-xs text-muted-foreground">{sprint.goal}</p>
        ) : null}
      </div>
      <div id={listId} hidden={collapsed} ref={setNodeRef}>
        {count === 0 ? empty : <ul className="divide-y">{children}</ul>}
      </div>
    </section>
  );
}

type RowField = "priority" | "assignee" | "storyPoints";

function BacklogRow({
  issue,
  projectKey,
  users,
  selected,
  onSelect,
  available,
  onMove,
  takeFocus,
  onFocused,
  moveTargets,
  onMoveTo,
}: {
  issue: PlanningIssue;
  projectKey: string;
  users: NamedOption[];
  /** ISS-12 bulk selection. */
  selected: boolean;
  onSelect: (range: boolean) => void;
  available: Record<MoveKind, boolean>;
  onMove: (kind: MoveKind) => void;
  takeFocus: boolean;
  /** Called once the row took focus, so a later remount does not take it again. */
  onFocused: () => void;
  /** BLG-3 keyboard alternative to dragging into another section. */
  moveTargets: { container: string; label: string }[];
  onMoveTo: (container: string) => void;
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
  const menuButton = useRef<HTMLButtonElement>(null);
  // Set when "Move to sprint…" was chosen: this row is about to remount in another section.
  const movedAway = useRef(false);
  useEffect(() => {
    if (!takeFocus) return;
    menuButton.current?.focus();
    onFocused();
  }, [takeFocus, onFocused]);
  const href = `/${projectKey}/issues/${issue.key}`;
  const points = saver.valueOf("storyPoints");
  const assignee = saver.valueOf("assignee");
  const assigneeId = typeof assignee === "string" ? assignee : null;

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
      {...selectRowProps(issue.id)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
      className={cn(
        "flex items-center gap-2 bg-background px-2 py-1.5 text-sm focus-within:bg-muted/60 hover:bg-muted/40",
        isDragging && "relative z-10 shadow-md",
        selected && "bg-primary/5",
      )}
    >
      <RowCheckbox
        label={`Select ${issue.key}`}
        checked={selected}
        onToggle={onSelect}
        className="ml-1"
      />
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
        className={cn(
          "min-w-0 flex-1 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
          issue.status.category === "done" && "text-muted-foreground line-through",
        )}
      >
        <span className="sr-only">{issue.key}: </span>
        {issue.title}
        {issue.status.category === "done" ? (
          <span className="sr-only"> ({issue.status.name})</span>
        ) : null}
      </Link>
      {/* A pick is one deliberate choice, so it saves at once (no debounce needed). */}
      <Select
        aria-label={`Priority of ${issue.key}`}
        label={`Priority of ${issue.key}`}
        className="w-20"
        align="end"
        value={PRIORITIES.find((p) => p === saver.valueOf("priority")) ?? null}
        options={priorityOptions({ short: true })}
        onChange={(next) => {
          if (next !== null) saver.change("priority", next, { immediate: true });
        }}
      />
      <Select
        aria-label={`Assignee of ${issue.key}`}
        label={`Assignee of ${issue.key}`}
        className="w-36"
        align="end"
        value={assigneeId}
        options={userOptions(users)}
        clearLabel="Unassigned"
        onChange={(next) => saver.change("assignee", next, { immediate: true })}
      />
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
      <MoveMenu
        itemLabel={issue.key}
        available={available}
        onMove={onMove}
        triggerRef={menuButton}
        keepFocusOnClose={() => {
          const moved = movedAway.current;
          movedAway.current = false;
          return moved;
        }}
      >
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Move to sprint…</DropdownMenuLabel>
        {moveTargets.map((target) => (
          <DropdownMenuItem
            key={target.container}
            onSelect={() => {
              movedAway.current = true;
              onMoveTo(target.container);
            }}
          >
            {target.label}
          </DropdownMenuItem>
        ))}
      </MoveMenu>
    </li>
  );
}
