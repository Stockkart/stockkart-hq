"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";

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
import { Select, type SelectOption } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import { LabelDot } from "@/features/issue/field-options";
import { type ActionResult } from "@/lib/action-result";
import { LABEL_MAX, labelNameSchema } from "@/lib/issues/schemas";
import { LABEL_COLOR_NAMES, LABEL_COLOR_VALUES, type LabelColor } from "@/lib/settings/constants";
import { type LabelSetting } from "@/lib/settings/views";
import {
  createLabelAction,
  deleteLabelAction,
  renameLabelAction,
  setLabelColorAction,
} from "@/server/actions/settings";

import { InlineText } from "./inline-text";

/** "No colour" in the picker (a value, so it can be picked like the others). */
const NO_COLOR = "none";
const COLOR_OPTIONS: SelectOption<string>[] = [
  { value: NO_COLOR, label: "No colour", icon: <LabelDot color={null} /> },
  ...LABEL_COLOR_VALUES.map((color) => ({
    value: color,
    label: LABEL_COLOR_NAMES[color],
    icon: <LabelDot color={color} />,
  })),
];
const toColor = (value: string | null): LabelColor | null =>
  LABEL_COLOR_VALUES.find((color) => color === value) ?? null;

type Change =
  | { kind: "add"; label: LabelSetting }
  | { kind: "rename"; id: string; name: string }
  | { kind: "color"; id: string; color: string | null }
  | { kind: "delete"; id: string };

function reduce(labels: LabelSetting[], change: Change): LabelSetting[] {
  switch (change.kind) {
    case "add":
      return [...labels, change.label].sort((a, b) => a.name.localeCompare(b.name));
    case "rename":
      return labels.map((l) => (l.id === change.id ? { ...l, name: change.name } : l));
    case "color":
      return labels.map((l) => (l.id === change.id ? { ...l, color: change.color } : l));
    case "delete":
      return labels.filter((l) => l.id !== change.id);
  }
}

/** The name as the server will store it, or the schema's message. */
function checkName(name: string): string | null {
  const parsed = labelNameSchema.safeParse(name);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid name");
}

/**
 * PRJ-3 labels: create, rename, colour (our own picker over a fixed palette) and delete
 * (which detaches it from every issue, recorded in each issue's history). Optimistic, with
 * rollback when the server refuses (e.g. a name already taken).
 */
export function LabelEditor({
  projectKey,
  labels,
}: {
  projectKey: string;
  labels: LabelSetting[];
}) {
  const [shown, apply] = useOptimistic(labels, reduce);
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [deleting, setDeleting] = useState<LabelSetting | null>(null);
  const titleId = useId();

  function run<T>(change: Change, action: () => Promise<ActionResult<T>>, said: string) {
    startTransition(async () => {
      apply(change);
      const ok = (await callAction(action)) !== null;
      setAnnouncement(ok ? said : "That change was not saved");
    });
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div>
        <h2 id={titleId} className="text-lg font-medium">
          Labels
        </h2>
        <p className="text-sm text-muted-foreground">
          Names are lower case with dashes, e.g. “needs-design”.
        </p>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No labels yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((label) => {
            const pending = label.id.startsWith("new:");
            return (
              <li key={label.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                <Select
                  aria-label={`Colour of ${label.name}`}
                  label={`Colour of ${label.name}`}
                  className="w-32"
                  disabled={pending}
                  value={toColor(label.color) ?? NO_COLOR}
                  options={COLOR_OPTIONS}
                  onChange={(next) => {
                    const color = toColor(next);
                    if (next === null || color === toColor(label.color)) return;
                    run(
                      { kind: "color", id: label.id, color },
                      () => setLabelColorAction({ labelId: label.id, color }),
                      `${label.name}: ${color ? LABEL_COLOR_NAMES[color] : "no colour"}`,
                    );
                  }}
                />
                <InlineText
                  label={`Name of label ${label.name}`}
                  value={label.name}
                  maxLength={LABEL_MAX}
                  className="w-48"
                  validate={checkName}
                  onCommit={(next) => {
                    const name = labelNameSchema.parse(next);
                    run(
                      { kind: "rename", id: label.id, name },
                      () => renameLabelAction({ labelId: label.id, name }),
                      `Renamed to ${name}`,
                    );
                  }}
                />
                <span className="flex-1 text-xs text-muted-foreground">
                  {label.issueCount} {label.issueCount === 1 ? "issue" : "issues"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={pending}
                  aria-label={`Delete label ${label.name}`}
                  onClick={() => setDeleting(label)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <AddLabelForm
        onAdd={(name, color) =>
          run(
            {
              kind: "add",
              label: { id: `new:${crypto.randomUUID()}`, name, color, issueCount: 0 },
            },
            () => createLabelAction({ projectKey, name, color }),
            `Added ${name}`,
          )
        }
      />
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete label “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting?.issueCount
                ? `It is removed from ${deleting.issueCount} ${deleting.issueCount === 1 ? "issue" : "issues"}; each one’s history records it.`
                : "No issue has it."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const label = deleting;
                setDeleting(null);
                if (label) {
                  run(
                    { kind: "delete", id: label.id },
                    () => deleteLabelAction({ labelId: label.id }),
                    `Deleted ${label.name}`,
                  );
                }
              }}
            >
              Delete label
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AddLabelForm({ onAdd }: { onAdd: (name: string, color: LabelColor | null) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(NO_COLOR);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), color: useId(), error: useId() };
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = labelNameSchema.safeParse(name);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Invalid name");
          return;
        }
        setError(null);
        onAdd(parsed.data, toColor(color));
        setName("");
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>New label</Label>
        <Input
          id={ids.name}
          value={name}
          maxLength={LABEL_MAX}
          autoComplete="off"
          placeholder="e.g. needs-design"
          className="h-8 w-48"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.color}>Colour</Label>
        <Select
          id={ids.color}
          label="Colour"
          className="w-32"
          value={color}
          options={COLOR_OPTIONS}
          onChange={(next) => setColor(next ?? NO_COLOR)}
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={!name.trim()}>
        <Plus aria-hidden="true" />
        Add label
      </Button>
      <p id={ids.error} aria-live="polite" className="basis-full text-sm text-destructive">
        {error}
      </p>
    </form>
  );
}
