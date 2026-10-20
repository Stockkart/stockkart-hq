"use client";

import { X } from "lucide-react";
import { type ChangeEvent, type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/issues/constants";
import { type IssueField, LABEL_MAX } from "@/lib/issues/schemas";
import {
  type IssueDetail,
  type IssueSummary,
  type LabelView,
  type ProjectMeta,
} from "@/lib/issues/views";
import { addLabelAction, removeLabelAction, updateIssueFieldAction } from "@/server/actions/issues";

import { callAction, RelativeTime } from "./client-utils";
import { type FieldValue, useFieldSaver } from "./use-field-saver";

interface IssueFieldsProps {
  issue: IssueDetail;
  meta: ProjectMeta;
  /** Parent options: epics for most types, non-epic issues for subtasks, none for epics. */
  parentOptions: IssueSummary[];
  currentUserId: string;
}

type PanelField = Exclude<IssueField, "title" | "description">;

/**
 * §5.4 side panel (ISS-5). Each control saves its own field (§9.4: last write wins per
 * field). Updates are optimistic and ordered (see `useFieldSaver`); the server then refreshes
 * the page, so activity stays current and edits by others show up.
 */
export function IssueFields({ issue, meta, parentOptions, currentUserId }: IssueFieldsProps) {
  const serverValues: Record<PanelField, FieldValue> = {
    status: issue.statusId,
    priority: issue.priority,
    assignee: issue.assigneeId,
    component: issue.componentId,
    storyPoints: issue.storyPoints,
    dueDate: issue.dueDate,
    parent: issue.parent?.id ?? null,
  };
  const { valueOf, change, flush } = useFieldSaver<PanelField>(
    serverValues,
    async (field, value) =>
      (await callAction(() => updateIssueFieldAction({ issueId: issue.id, field, value }))) !==
      null,
  );
  const ids = {
    status: useId(),
    priority: useId(),
    assignee: useId(),
    component: useId(),
    points: useId(),
    due: useId(),
    parent: useId(),
  };

  /** Props for a native select bound to a field: change (debounced) and flush on blur. */
  const bind = (field: PanelField, parse: (raw: string) => FieldValue | undefined) => ({
    value: String(valueOf(field) ?? ""),
    onChange: (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      const next = parse(event.target.value);
      if (next !== undefined) change(field, next);
    },
    onBlur: () => flush(field),
  });
  const idOrNull = (raw: string) => raw || null;

  const parentLabel = issue.type === "subtask" ? "Parent" : "Epic";
  const assignee = valueOf("assignee");
  const storyPoints = valueOf("storyPoints");

  return (
    <aside aria-label="Issue details" className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2.5">
        <Field label="Status" htmlFor={ids.status}>
          <NativeSelect id={ids.status} {...bind("status", (raw) => raw || undefined)}>
            {meta.statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Priority" htmlFor={ids.priority}>
          <NativeSelect
            id={ids.priority}
            {...bind("priority", (raw) => PRIORITIES.find((p) => String(p) === raw))}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Assignee" htmlFor={ids.assignee}>
          <div className="flex items-center gap-1">
            <NativeSelect id={ids.assignee} className="flex-1" {...bind("assignee", idOrNull)}>
              <option value="">Unassigned</option>
              {meta.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </NativeSelect>
            {assignee !== currentUserId ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => change("assignee", currentUserId, { immediate: true })}
              >
                Me<span className="sr-only">: assign to me</span>
              </Button>
            ) : null}
          </div>
        </Field>

        <Field label="Component" htmlFor={ids.component}>
          <NativeSelect id={ids.component} {...bind("component", idOrNull)}>
            <option value="">None</option>
            {meta.components.map((component) => (
              <option key={component.id} value={component.id}>
                {component.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Labels">
          <LabelsField issueId={issue.id} labels={issue.labels} projectLabels={meta.labels} />
        </Field>

        <Field label="Points" htmlFor={ids.points}>
          <NumberField
            id={ids.points}
            value={typeof storyPoints === "number" ? storyPoints : null}
            onSave={(value) => change("storyPoints", value, { immediate: true })}
          />
        </Field>

        <Field label="Due date" htmlFor={ids.due}>
          <Input
            id={ids.due}
            type="date"
            className="h-8"
            {...bind("dueDate", idOrNull)}
            onKeyDown={(event) => {
              if (event.key === "Enter") flush("dueDate");
            }}
          />
        </Field>

        {issue.type !== "epic" ? (
          <Field label={parentLabel} htmlFor={ids.parent}>
            <NativeSelect id={ids.parent} {...bind("parent", idOrNull)}>
              {/* ISS-3: a subtask always has a parent, so it cannot be cleared. */}
              {issue.type !== "subtask" ? <option value="">None</option> : null}
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.key} {option.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </dl>

      <div className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
        <p>
          Created <RelativeTime date={issue.createdAt} />
          {issue.reporter ? ` by ${issue.reporter.name}` : null}
        </p>
        <p>
          Updated <RelativeTime date={issue.updatedAt} />
        </p>
        {issue.resolvedAt ? (
          <p>
            Resolved <RelativeTime date={issue.resolvedAt} />
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** Saves on blur or Enter; empty clears the value. */
function NumberField({
  id,
  value,
  onSave,
}: {
  id: string;
  value: number | null;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  // Follow the saved value (e.g. after a refresh) without remounting, which would drop focus.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value === null ? "" : String(value));
  }
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError(null);
      if (value !== null) onSave(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999) {
      setError("Whole number, 0–999");
      return;
    }
    setError(null);
    if (parsed !== value) onSave(parsed);
  };
  return (
    <div>
      <Input
        id={id}
        inputMode="numeric"
        className="h-8 w-24"
        value={draft}
        placeholder="–"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      <p id={`${id}-error`} aria-live="polite" className="text-xs text-destructive">
        {error}
      </p>
    </div>
  );
}

function LabelsField({
  issueId,
  labels,
  projectLabels,
}: {
  issueId: string;
  labels: LabelView[];
  projectLabels: LabelView[];
}) {
  const [shown, setShown] = useState(labels);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const listId = useId();
  // Follow server data after a refresh (e.g. someone else changed the labels).
  const labelsKey = labels.map((label) => label.id).join(",");
  const [seenKey, setSeenKey] = useState(labelsKey);
  if (seenKey !== labelsKey) {
    setSeenKey(labelsKey);
    setShown(labels);
  }

  async function add() {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    const result = await callAction(() => addLabelAction({ issueId, name }));
    if (result === null) {
      setDraft(name);
      return;
    }
    const normalised = name.replace(/\s+/g, "-").toLowerCase();
    setShown((current) =>
      current.some((label) => label.id === result.labelId)
        ? current
        : [...current, { id: result.labelId, name: normalised, color: null }].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
    );
  }

  async function remove(label: LabelView) {
    setShown((current) => current.filter((item) => item.id !== label.id));
    const result = await callAction(() => removeLabelAction({ issueId, labelId: label.id }));
    if (result === null) setShown((current) => [...current, label]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {shown.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Labels">
          {shown.map((label) => (
            <li
              key={label.id}
              className="inline-flex items-center gap-0.5 rounded-full border bg-secondary py-0.5 pr-0.5 pl-2 text-xs"
            >
              {label.name}
              <button
                type="button"
                aria-label={`Remove label ${label.name}`}
                onClick={() => void remove(label)}
                className="rounded-full p-0.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={inputId} className="sr-only">
        Add label
      </label>
      <Input
        id={inputId}
        list={listId}
        className="h-8"
        placeholder="Add label…"
        maxLength={LABEL_MAX}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add();
          }
        }}
      />
      <datalist id={listId}>
        {projectLabels
          .filter((label) => !shown.some((item) => item.id === label.id))
          .map((label) => (
            <option key={label.id} value={label.name} />
          ))}
      </datalist>
    </div>
  );
}
