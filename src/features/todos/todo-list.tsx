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
import { ArrowUpRight, ChevronRight, GripVertical, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { callAction } from "@/features/issue/client-utils";
import { openQuickCreate } from "@/features/issue/quick-create-events";
import { MoveMenu } from "@/features/planning/move-menu";
import { applyMove, availableMoves, dropOnto, moveBy, type MoveKind } from "@/lib/planning/reorder";
import { TODO_TEXT_MAX } from "@/lib/todos/schemas";
import { cn } from "@/lib/utils";
import {
  addTodoAction,
  deleteTodoAction,
  editTodoAction,
  moveTodoAction,
  setTodoDoneAction,
} from "@/server/actions/todos";

/** Plain data from the server (`TodoView`). */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  promotedIssue: { key: string; href: string } | null;
}

type Change =
  | { kind: "add"; todo: TodoItem }
  | { kind: "edit"; id: string; text: string }
  | { kind: "done"; id: string; done: boolean }
  | { kind: "delete"; id: string }
  | { kind: "move"; id: string; afterId: string | null };

function reduce(state: TodoItem[], change: Change): TodoItem[] {
  switch (change.kind) {
    case "add":
      return [...state, change.todo];
    case "edit":
      return state.map((todo) => (todo.id === change.id ? { ...todo, text: change.text } : todo));
    case "done":
      return state.map((todo) => (todo.id === change.id ? { ...todo, done: change.done } : todo));
    case "delete":
      return state.filter((todo) => todo.id !== change.id);
    case "move":
      return applyMove(state, change.id, change.afterId);
  }
}

/**
 * MY-2/3 personal todo list. Every change is optimistic (`useOptimistic`): the server
 * action revalidates /todos and the fresh list replaces the optimistic one in the same
 * transition; a failed action ends the transition without new data, which rolls back.
 */
export function TodoList({ todos }: { todos: TodoItem[] }) {
  const [optimistic, apply] = useOptimistic(todos, reduce);
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const inputId = useId();
  const doneListId = useId();
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const open = optimistic.filter((todo) => !todo.done);
  const done = optimistic.filter((todo) => todo.done);
  const openIds = open.map((todo) => todo.id);

  function run(change: Change, action: () => ReturnType<typeof setTodoDoneAction>, said: string) {
    startTransition(async () => {
      apply(change);
      const ok = (await callAction(action)) !== null;
      setAnnouncement(ok ? said : "That change could not be saved");
    });
  }

  function add() {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!text) return;
    setDraft("");
    startTransition(async () => {
      apply({
        kind: "add",
        todo: { id: `pending-${crypto.randomUUID()}`, text, done: false, promotedIssue: null },
      });
      const created = await callAction(() => addTodoAction({ text }));
      // Give the text back so nothing typed is lost.
      if (!created) setDraft((current) => current || text);
      setAnnouncement(created ? `Added “${text}”` : "The todo could not be added");
    });
  }

  function move(id: string, afterId: string | null, said: string) {
    run(
      { kind: "move", id, afterId },
      () => moveTodoAction({ todoId: id, afterTodoId: afterId }),
      said,
    );
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const reorder = dropOnto(openIds, String(event.active.id), String(event.over.id));
    if (reorder) move(String(event.active.id), reorder.afterId, "Todo moved");
  }

  function onMenuMove(id: string, kind: MoveKind) {
    const reorder = moveBy(openIds, id, kind);
    if (!reorder) return;
    const position = reorder.order.indexOf(id) + 1;
    move(id, reorder.afterId, `Todo moved to position ${position} of ${openIds.length}`);
  }

  const rowProps = (todo: TodoItem) => ({
    todo,
    onToggle: (next: boolean) =>
      run(
        { kind: "done", id: todo.id, done: next },
        () => setTodoDoneAction({ todoId: todo.id, done: next }),
        next ? `Completed “${todo.text}”` : `Reopened “${todo.text}”`,
      ),
    onEdit: (text: string) =>
      run(
        { kind: "edit", id: todo.id, text },
        () => editTodoAction({ todoId: todo.id, text }),
        "Todo updated",
      ),
    onDelete: () =>
      run(
        { kind: "delete", id: todo.id },
        () => deleteTodoAction({ todoId: todo.id }),
        `Deleted “${todo.text}”`,
      ),
  });

  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label htmlFor={inputId} className="text-sm font-medium">
          Add a todo
        </label>
        <Input
          id={inputId}
          value={draft}
          maxLength={TODO_TEXT_MAX}
          autoComplete="off"
          placeholder="Write it down and press Enter"
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>

      <section aria-labelledby={`${inputId}-open`}>
        <h2 id={`${inputId}-open`} className="mb-2 text-sm font-medium text-muted-foreground">
          To do ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing to do. Enjoy it, or add something above.
          </p>
        ) : (
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
              <ul className="divide-y rounded-lg border">
                {open.map((todo, index) => (
                  <SortableTodo
                    key={todo.id}
                    {...rowProps(todo)}
                    available={availableMoves(index, open.length)}
                    onMove={(kind) => onMenuMove(todo.id, kind)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {done.length > 0 ? (
        <section>
          <h2>
            <button
              type="button"
              aria-expanded={showDone}
              aria-controls={doneListId}
              onClick={() => setShowDone((value) => !value)}
              className="flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn("size-4 transition-transform", showDone && "rotate-90")}
              />
              Completed ({done.length})
            </button>
          </h2>
          <ul id={doneListId} hidden={!showDone} className="mt-2 divide-y rounded-lg border">
            {done.map((todo) => (
              <li key={todo.id} className="flex items-center gap-2 px-2 py-1.5">
                <TodoBody {...rowProps(todo)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

interface RowProps {
  todo: TodoItem;
  onToggle: (done: boolean) => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}

function SortableTodo({
  available,
  onMove,
  ...props
}: RowProps & { available: Record<MoveKind, boolean>; onMove: (kind: MoveKind) => void }) {
  const pending = props.todo.id.startsWith("pending-");
  // Destructured: the React Compiler lint treats the hook's result object as a ref.
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.todo.id, disabled: pending });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
      className={cn(
        "flex items-center gap-2 bg-background px-2 py-1.5",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={pending}
        aria-label={`Reorder “${props.todo.text}” (space to pick up, arrows to move, space to drop)`}
        className="cursor-grab touch-none rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <TodoBody {...props} />
      {pending ? null : (
        <MoveMenu itemLabel={`“${props.todo.text}”`} available={available} onMove={onMove}>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={props.onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </MoveMenu>
      )}
    </li>
  );
}

function TodoBody({ todo, onToggle, onEdit, onDelete }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(todo.text);
  const checkboxId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = todo.id.startsWith("pending-");

  // The field replaces the text the user just chose to edit, so it takes focus.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function finish(save: boolean) {
    setEditing(false);
    const next = text.replace(/\s+/g, " ").trim();
    if (save && next && next !== todo.text) onEdit(next);
    else setText(todo.text);
    // Back to the Edit button, so keyboard users keep their place.
    requestAnimationFrame(() => editRef.current?.focus());
  }

  return (
    <>
      <input
        id={checkboxId}
        type="checkbox"
        checked={todo.done}
        disabled={pending}
        onChange={(event) => onToggle(event.target.checked)}
        className="size-4 shrink-0 accent-primary"
      />
      {editing ? (
        <Input
          ref={inputRef}
          aria-label="Edit todo"
          value={text}
          maxLength={TODO_TEXT_MAX}
          className="h-8 flex-1"
          onChange={(event) => setText(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finish(true);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              finish(false);
            }
          }}
        />
      ) : (
        <label
          htmlFor={checkboxId}
          className={cn(
            "min-w-0 flex-1 text-sm break-words",
            todo.done && "text-muted-foreground line-through",
          )}
        >
          {todo.text}
        </label>
      )}
      {todo.promotedIssue ? (
        <Link
          href={todo.promotedIssue.href}
          aria-label={`Promoted to ${todo.promotedIssue.key}`}
          className="rounded-full border px-2 py-0.5 font-mono text-xs hover:bg-muted"
        >
          {todo.promotedIssue.key}
        </Link>
      ) : pending || todo.done ? null : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Promote “${todo.text}” to an issue`}
          onClick={() => openQuickCreate({ title: todo.text, promoteTodoId: todo.id })}
        >
          <ArrowUpRight aria-hidden="true" />
          Promote
        </Button>
      )}
      {editing || pending ? null : (
        <Button
          ref={editRef}
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Edit “${todo.text}”`}
          onClick={() => {
            setText(todo.text);
            setEditing(true);
          }}
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
      {todo.done && !pending ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Delete “${todo.text}”`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
    </>
  );
}
