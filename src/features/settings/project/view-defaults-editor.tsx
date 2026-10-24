"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/select";
import { typeOptions } from "@/features/issue/field-options";
import { StatusBadge } from "@/features/issue/issue-badges";
import { ISSUE_TYPES } from "@/lib/issues/constants";
import { type StatusSetting } from "@/lib/settings/views";
import {
  KEEP_ONE_VISIBLE_MESSAGE,
  normaliseView,
  type ProjectViewDefaults,
  type ResolvedView,
  resolveDefaults,
  sameView,
  viewDefaultsOf,
} from "@/lib/views/view-defaults";
import { saveViewDefaultsAction } from "@/server/actions/settings";

type Side = "board" | "list";

const SIDES: { side: Side; title: string; hint: string; statusesLabel: string }[] = [
  {
    side: "board",
    title: "Board",
    hint: "What the board shows when its link names no types or columns. People can still change the view on the board; “Save as default” there writes these settings too.",
    statusesLabel: "Columns shown",
  },
  {
    side: "list",
    title: "Issues list",
    hint: "The list starts with these filters when its link names no type or status and no saved view is open. Saved views keep their own filters.",
    statusesLabel: "Statuses shown",
  },
];

/**
 * BRD-6 / VW-4 "Views" tab: the default issue types and visible statuses of the board and
 * the issue list. One form, one save (`saveViewDefaultsAction`, the edited sides only); at
 * least one
 * status stays visible per side (the checkbox of the last one is disabled, and the server
 * refuses it too). Settings changes log no activity, as elsewhere.
 */
export function ViewDefaultsEditor({
  projectKey,
  statuses,
  defaults,
}: {
  projectKey: string;
  statuses: StatusSetting[];
  defaults: ProjectViewDefaults;
}) {
  const statusIds = statuses.map((status) => status.id);
  const saved = {
    board: resolveDefaults(defaults.board, statusIds),
    list: resolveDefaults(defaults.list, statusIds),
  };
  const [draft, setDraft] = useState(saved);
  // New saved defaults from the server (after a save here or elsewhere) replace the draft of
  // each side the user has not edited; an edited side keeps the user's changes.
  const [seen, setSeen] = useState(saved);
  if (!sameView(seen.board, saved.board) || !sameView(seen.list, saved.list)) {
    setSeen(saved);
    setDraft((current) => ({
      board: sameView(current.board, seen.board) ? saved.board : current.board,
      list: sameView(current.list, seen.list) ? saved.list : current.list,
    }));
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorId = useId();
  const changed = {
    board: !sameView(draft.board, saved.board),
    list: !sameView(draft.list, saved.list),
  };
  const dirty = changed.board || changed.list;

  function change(side: Side, next: Partial<ResolvedView>) {
    setError(null);
    setDraft((current) => ({
      ...current,
      [side]: { ...current[side], ...next },
    }));
  }

  function save() {
    const board = normaliseView(draft.board, statusIds);
    const list = normaliseView(draft.list, statusIds);
    // normaliseView turns "every status hidden" into "none hidden"; refuse it instead.
    if ([draft.board, draft.list].some((view) => view.hidden.length >= statusIds.length)) {
      setError(KEEP_ONE_VISIBLE_MESSAGE);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // Only the edited sides, so a default saved elsewhere meanwhile is kept.
        const result = await saveViewDefaultsAction({
          projectKey,
          ...(changed.board ? { board: viewDefaultsOf(board) } : {}),
          ...(changed.list ? { list: viewDefaultsOf(list) } : {}),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success("Saved the view defaults");
      } catch {
        setError("Something went wrong. Reload the page and try again.");
      }
    });
  }

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      aria-describedby={error ? errorId : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {SIDES.map(({ side, title, hint, statusesLabel }) => (
        <ViewSection
          key={side}
          title={title}
          hint={hint}
          statusesLabel={statusesLabel}
          statuses={statuses}
          view={draft[side]}
          onChange={(next) => change(side, next)}
        />
      ))}
      <p
        id={errorId}
        role="alert"
        aria-live="assertive"
        className="min-h-5 text-sm text-destructive"
      >
        {error}
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {dirty ? (
          <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ViewSection({
  title,
  hint,
  statusesLabel,
  statuses,
  view,
  onChange,
}: {
  title: string;
  hint: string;
  statusesLabel: string;
  statuses: StatusSetting[];
  view: ResolvedView;
  onChange: (next: Partial<ResolvedView>) => void;
}) {
  const headingId = useId();
  const typesId = useId();
  const statusesId = useId();
  const options = typeOptions(ISSUE_TYPES);
  const visible = statuses.filter((status) => !view.hidden.includes(status.id)).length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 id={headingId} className="font-medium">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={typesId} className="text-sm font-medium">
          Issue types shown by default
        </label>
        <MultiSelect
          id={typesId}
          label="Issue types shown by default"
          placeholder="All types"
          className="w-full max-w-sm"
          value={view.types}
          options={options}
          onChange={(next) => onChange({ types: next })}
        />
      </div>
      <fieldset className="flex flex-col gap-1.5" aria-describedby={statusesId}>
        <legend className="text-sm font-medium">{statusesLabel}</legend>
        <p id={statusesId} className="text-xs text-muted-foreground">
          In workflow order. At least one stays visible; up to 20 can be hidden.
        </p>
        <ul className="flex flex-col gap-1">
          {statuses.map((status) => (
            <StatusCheckbox
              key={status.id}
              status={status}
              checked={!view.hidden.includes(status.id)}
              // The last visible status cannot be hidden.
              disabled={!view.hidden.includes(status.id) && visible <= 1}
              onChange={(shown) =>
                onChange({
                  hidden: shown
                    ? view.hidden.filter((id) => id !== status.id)
                    : [...view.hidden, status.id],
                })
              }
            />
          ))}
        </ul>
      </fieldset>
    </section>
  );
}

function StatusCheckbox({
  status,
  checked,
  disabled,
  onChange,
}: {
  status: StatusSetting;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className="text-sm">
        <span className="sr-only">{status.name}</span>
        <span aria-hidden="true">
          <StatusBadge name={status.name} category={status.category} />
        </span>
      </label>
    </li>
  );
}
