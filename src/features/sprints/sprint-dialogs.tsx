"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SPRINT_GOAL_MAX, SPRINT_NAME_MAX } from "@/lib/sprints/constants";
import { addDays, daysBetween, formatDateRange } from "@/lib/sprints/dates";
import { type CarryTarget, sprintFormInput, type SprintFormValues } from "@/lib/sprints/schemas";
import { type SprintSummary } from "@/lib/sprints/views";

/**
 * SPR-1/SPR-2 dialogs. Presentational: each one validates its own input and hands the
 * confirmed values to `onConfirm`; the caller runs the action optimistically and closes the
 * dialog. Radix dialogs trap focus, close on Esc and return focus to the opener; each one
 * puts the initial focus on its first field or its main button, so the whole flow works
 * from the keyboard.
 */

interface DialogBase {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const points = (value: number) => `${value} ${value === 1 ? "pt" : "pts"}`;
const issues = (value: number) => `${value} ${value === 1 ? "issue" : "issues"}`;

/** Create or edit a sprint: name, goal, start and end date. */
export function SprintFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  sprintLengthDays,
  onConfirm,
}: DialogBase & {
  mode: "create" | "edit";
  initial: { name: string; goal: string | null; startDate: string; endDate: string };
  sprintLengthDays: number;
  onConfirm: (values: SprintFormValues & { goal: string | null }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        // Mounted per opening, so the form starts from `initial` every time.
        <SprintForm
          mode={mode}
          initial={initial}
          sprintLengthDays={sprintLengthDays}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}

function SprintForm({
  mode,
  initial,
  sprintLengthDays,
  onCancel,
  onConfirm,
}: {
  mode: "create" | "edit";
  initial: { name: string; goal: string | null; startDate: string; endDate: string };
  sprintLengthDays: number;
  onCancel: () => void;
  onConfirm: (values: SprintFormValues & { goal: string | null }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal ?? "");
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  // The end follows the start (keeping the sprint length) until it is edited by hand.
  const [endEdited, setEndEdited] = useState(mode === "edit");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), goal: useId(), start: useId(), end: useId(), error: useId() };

  function submit() {
    const parsed = sprintFormInput.safeParse({ name, goal, startDate, endDate });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields");
      return;
    }
    setError(null);
    onConfirm({ ...parsed.data, goal: parsed.data.goal });
  }

  const length = startDate && endDate ? daysBetween(startDate, endDate) + 1 : null;

  return (
    <DialogContent
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        nameRef.current?.focus();
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create sprint" : `Edit ${initial.name}`}</DialogTitle>
          <DialogDescription>
            The end date follows the start ({sprintLengthDays}-day sprints) until you change it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>Name</Label>
          <Input
            id={ids.name}
            ref={nameRef}
            value={name}
            maxLength={SPRINT_NAME_MAX}
            aria-required="true"
            autoComplete="off"
            aria-describedby={error ? ids.error : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.goal}>Goal</Label>
          <textarea
            id={ids.goal}
            value={goal}
            rows={2}
            maxLength={SPRINT_GOAL_MAX}
            placeholder="What should this sprint achieve? (optional)"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              // Enter submits like the other fields; Shift+Enter adds a line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.start}>Start date</Label>
            <Input
              id={ids.start}
              type="date"
              value={startDate}
              aria-required="true"
              onChange={(event) => {
                const next = event.target.value;
                setStartDate(next);
                if (!endEdited && next)
                  setEndDate(addDays(next, Math.max(1, sprintLengthDays) - 1));
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.end}>End date</Label>
            <Input
              id={ids.end}
              type="date"
              value={endDate}
              aria-required="true"
              aria-describedby={error ? ids.error : undefined}
              onChange={(event) => {
                setEndEdited(true);
                setEndDate(event.target.value);
              }}
            />
          </div>
          <p className="self-end pb-2 text-sm text-muted-foreground" aria-live="polite">
            {length !== null && length > 0 ? `${length} ${length === 1 ? "day" : "days"}` : null}
          </p>
        </div>
        <p
          id={ids.error}
          role="alert"
          aria-live="assertive"
          className="min-h-5 text-sm text-destructive"
        >
          {error}
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{mode === "create" ? "Create sprint" : "Save"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** A summary list (dates, goal, counts) shown in the start and complete dialogs. */
function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * SPR-1 start confirmation: issue count, committed points, dates and goal. Blocked (with the
 * reason) while another sprint is active; the server enforces it too.
 */
export function StartSprintDialog({
  open,
  onOpenChange,
  sprint,
  activeSprintName,
  onConfirm,
}: DialogBase & {
  sprint: SprintSummary;
  /** The project's active sprint, if any. */
  activeSprintName: string | null;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const blocked = activeSprintName !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (blocked ? cancelRef : confirmRef).current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Start {sprint.name}?</DialogTitle>
          <DialogDescription>
            The burndown starts from the work committed now; issues added later show as scope added.
          </DialogDescription>
        </DialogHeader>
        <Facts
          rows={[
            ["Dates", formatDateRange(sprint.startDate, sprint.endDate)],
            ["Goal", sprint.goal ?? "No goal"],
            ["Issues", issues(sprint.open.count)],
            ["Committed", points(sprint.open.points)],
          ]}
        />
        {blocked ? (
          <p role="alert" className="text-sm text-destructive">
            {activeSprintName} is active. Complete it before starting another sprint.
          </p>
        ) : null}
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button ref={confirmRef} type="button" disabled={blocked} onClick={onConfirm}>
            Start sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * SPR-2 completion: done vs open issues and points, and where the open ones go (the next
 * planned sprint, a new one if there is none, or the backlog).
 */
export function CompleteSprintDialog({
  open,
  onOpenChange,
  sprint,
  nextSprintName,
  newSprintName,
  onConfirm,
}: DialogBase & {
  sprint: SprintSummary;
  /** The earliest planned sprint, or null when completing creates one. */
  nextSprintName: string | null;
  /** The name a new sprint would get ("Sprint N"). */
  newSprintName: string;
  onConfirm: (carryTo: CarryTarget) => void;
}) {
  const [carryTo, setCarryTo] = useState<CarryTarget>("next");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const firstChoiceRef = useRef<HTMLInputElement>(null);
  const name = useId();
  const legend = useId();
  const hasOpen = sprint.open.count > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setCarryTo("next");
        onOpenChange(next);
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (hasOpen ? firstChoiceRef : confirmRef).current?.focus();
        }}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(carryTo);
          }}
        >
          <DialogHeader>
            <DialogTitle>Complete {sprint.name}?</DialogTitle>
            <DialogDescription>
              Done issues stay in the sprint and count towards velocity; Won&apos;t Do does not.
            </DialogDescription>
          </DialogHeader>
          <Facts
            rows={[
              ["Done", `${issues(sprint.done.count)} · ${points(sprint.done.points)}`],
              ["Won't Do", `${issues(sprint.wontDo.count)} · ${points(sprint.wontDo.points)}`],
              ["Open", `${issues(sprint.open.count)} · ${points(sprint.open.points)}`],
            ]}
          />
          {hasOpen ? (
            <fieldset aria-labelledby={legend} className="flex flex-col gap-2">
              <legend id={legend} className="mb-1 text-sm font-medium">
                Move the {issues(sprint.open.count)} still open to
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  ref={firstChoiceRef}
                  type="radio"
                  name={name}
                  value="next"
                  checked={carryTo === "next"}
                  onChange={() => setCarryTo("next")}
                  className="size-4 accent-primary"
                />
                {nextSprintName
                  ? `The next sprint: ${nextSprintName}`
                  : `A new sprint (${newSprintName})`}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={name}
                  value="backlog"
                  checked={carryTo === "backlog"}
                  onChange={() => setCarryTo("backlog")}
                  className="size-4 accent-primary"
                />
                The backlog
              </label>
            </fieldset>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button ref={confirmRef} type="submit">
              Complete sprint
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Deleting a planned sprint returns its issues to the backlog. */
export function DeleteSprintDialog({
  open,
  onOpenChange,
  sprint,
  onConfirm,
}: DialogBase & { sprint: SprintSummary; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const count = sprint.open.count + sprint.done.count + sprint.wontDo.count;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // The safe choice first.
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete {sprint.name}?</DialogTitle>
          <DialogDescription>
            {count > 0
              ? `Its ${issues(count)} go back to the backlog. The issues themselves are kept.`
              : "It has no issues."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Delete sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
