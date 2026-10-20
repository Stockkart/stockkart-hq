"use client";

import { X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect, Select } from "@/components/ui/select";
import { PRIORITIES } from "@/lib/issues/constants";
import { type IssueField, LABEL_MAX } from "@/lib/issues/schemas";
import {
  type IssueDetail,
  type IssueSummary,
  type LabelView,
  type ProjectMeta,
} from "@/lib/issues/views";
import { addLabelAction, removeLabelAction, updateIssueFieldAction } from "@/server/actions/issues";

import { callAction, RelativeTime } from "./client-utils";
import {
  issueOptions,
  LabelDot,
  labelOptions,
  priorityOptions,
  statusOptions,
  userOptions,
} from "./field-options";
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
 * the page, so activity stays current and edits by others show up. A pick in a picker is one
 * deliberate choice, so it saves at once; the date input keeps the debounced save.
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
    labels: useId(),
  };

  /** A picker's value for a field holding an id. */
  const idOf = (field: PanelField) => {
    const value = valueOf(field);
    return typeof value === "string" ? value : null;
  };
  const pick = (field: PanelField, value: FieldValue) => change(field, value, { immediate: true });
  const priority = PRIORITIES.find((p) => p === valueOf("priority")) ?? null;

  const parentLabel = issue.type === "subtask" ? "Parent" : "Epic";
  const assignee = valueOf("assignee");
  const storyPoints = valueOf("storyPoints");

  return (
    <aside aria-label="Issue details" className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2.5">
        <Field label="Status" htmlFor={ids.status}>
          <Select
            id={ids.status}
            label="Status"
            value={idOf("status")}
            options={statusOptions(meta.statuses)}
            onChange={(value) => {
              if (value) pick("status", value);
            }}
          />
        </Field>

        <Field label="Priority" htmlFor={ids.priority}>
          <Select
            id={ids.priority}
            label="Priority"
            value={priority}
            options={priorityOptions()}
            onChange={(value) => {
              if (value !== null) pick("priority", value);
            }}
          />
        </Field>

        <Field label="Assignee" htmlFor={ids.assignee}>
          <div className="flex items-center gap-1">
            <Select
              id={ids.assignee}
              label="Assignee"
              className="flex-1"
              value={idOf("assignee")}
              options={userOptions(meta.users)}
              clearLabel="Unassigned"
              onChange={(value) => pick("assignee", value)}
            />
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
          <Select
            id={ids.component}
            label="Component"
            value={idOf("component")}
            options={meta.components.map((component) => ({
              value: component.id,
              label: component.name,
            }))}
            clearLabel="None"
            onChange={(value) => pick("component", value)}
          />
        </Field>

        <Field label="Labels" htmlFor={ids.labels}>
          <LabelsField
            id={ids.labels}
            issueId={issue.id}
            labels={issue.labels}
            projectLabels={meta.labels}
          />
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
            // Typing a date digit by digit: debounced, saved at once on blur (useFieldSaver).
            value={idOf("dueDate") ?? ""}
            onChange={(event) => change("dueDate", event.target.value || null)}
            onBlur={() => flush("dueDate")}
            onKeyDown={(event) => {
              if (event.key === "Enter") flush("dueDate");
            }}
          />
        </Field>

        {issue.type !== "epic" ? (
          <Field label={parentLabel} htmlFor={ids.parent}>
            <Select
              id={ids.parent}
              label={parentLabel}
              value={idOf("parent")}
              options={issueOptions(parentOptions)}
              // ISS-3: a subtask always has a parent, so it cannot be cleared.
              clearLabel={issue.type !== "subtask" ? "None" : undefined}
              placeholder="Choose a parent…"
              onChange={(value) => pick("parent", value)}
            />
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

/** Lower case, spaces as dashes: how the server stores label names (ISS-5). */
const labelName = (text: string) => text.trim().replace(/\s+/g, "-").toLowerCase();

/**
 * Labels: chips (each removable) and a multi-select to toggle or create labels. Every change
 * is optimistic: it shows at once and is rolled back if the server refuses.
 */
function LabelsField({
  id,
  issueId,
  labels,
  projectLabels,
}: {
  id: string;
  issueId: string;
  labels: LabelView[];
  projectLabels: LabelView[];
}) {
  const [shown, setShown] = useState(labels);
  // Follow server data after a refresh (e.g. someone else changed the labels).
  const labelsKey = labels.map((label) => label.id).join(",");
  const [seenKey, setSeenKey] = useState(labelsKey);
  if (seenKey !== labelsKey) {
    setSeenKey(labelsKey);
    setShown(labels);
  }
  // Labels created here are not in the project list until the page refreshes.
  const known = [
    ...projectLabels,
    ...shown.filter((l) => !projectLabels.some((p) => p.id === l.id)),
  ];
  const sorted = (list: LabelView[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

  async function add(name: string, existing?: LabelView) {
    const optimistic = existing ?? { id: `new:${name}`, name, color: null };
    if (shown.some((label) => label.name === name)) return;
    setShown((current) => sorted([...current, optimistic]));
    const result = await callAction(() => addLabelAction({ issueId, name }));
    setShown((current) => {
      const without = current.filter((label) => label.id !== optimistic.id);
      if (result === null) return without;
      return without.some((label) => label.id === result.labelId)
        ? without
        : sorted([...without, { ...optimistic, id: result.labelId }]);
    });
  }

  async function remove(label: LabelView) {
    setShown((current) => current.filter((item) => item.id !== label.id));
    const result = await callAction(() => removeLabelAction({ issueId, labelId: label.id }));
    if (result === null) setShown((current) => sorted([...current, label]));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {shown.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Labels">
          {shown.map((label) => (
            <li
              key={label.id}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pr-0.5 pl-2 text-xs"
            >
              <LabelDot color={label.color} />
              {label.name}
              <button
                type="button"
                aria-label={`Remove label ${label.name}`}
                disabled={label.id.startsWith("new:")}
                onClick={() => void remove(label)}
                className="rounded-full p-0.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <MultiSelect
        id={id}
        label="Labels"
        value={shown.map((label) => label.id)}
        options={labelOptions(known)}
        searchable
        onCreate={(text) => void add(labelName(text))}
        createMaxLength={LABEL_MAX}
        createLabel={(text) => `Create label “${labelName(text)}”`}
        onChange={(_next, { value, selected }) => {
          const label = known.find((item) => item.id === value);
          if (!label) return;
          if (selected) void add(label.name, label);
          else void remove(label);
        }}
      >
        {() => (
          <>
            <span className="truncate text-muted-foreground">
              {shown.length > 0 ? "Add or remove…" : "Add label…"}
            </span>
          </>
        )}
      </MultiSelect>
    </div>
  );
}
