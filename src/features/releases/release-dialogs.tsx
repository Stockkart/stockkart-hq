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
import { Select } from "@/components/ui/select";
import { RELEASE_DESCRIPTION_MAX, RELEASE_NAME_MAX } from "@/lib/releases/constants";
import { type MarkReleasedInput, releaseFormInput } from "@/lib/releases/schemas";
import { type ReleaseSummary } from "@/lib/releases/views";

/**
 * REL-1 dialogs. Presentational: each validates its own input and hands the confirmed
 * values to `onConfirm`; the caller runs the action optimistically and closes the dialog.
 * Radix dialogs trap focus, close on Esc and return focus to the opener; each puts the
 * initial focus on its first field or its safest button, so it all works from the keyboard.
 */

interface DialogBase {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface ReleaseFormValues {
  name: string;
  releaseDate: string | null;
  description: string | null;
}

const issues = (count: number) => `${count} ${count === 1 ? "issue" : "issues"}`;

/** Create or edit a release: name (unique per project), target date, description. */
export function ReleaseFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onConfirm,
}: DialogBase & {
  mode: "create" | "edit";
  initial: ReleaseFormValues;
  onConfirm: (values: ReleaseFormValues) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        // Mounted per opening, so the form starts from `initial` every time.
        <ReleaseForm
          mode={mode}
          initial={initial}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}

function ReleaseForm({
  mode,
  initial,
  onCancel,
  onConfirm,
}: {
  mode: "create" | "edit";
  initial: ReleaseFormValues;
  onCancel: () => void;
  onConfirm: (values: ReleaseFormValues) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [releaseDate, setReleaseDate] = useState(initial.releaseDate ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), date: useId(), description: useId(), error: useId() };

  function submit() {
    const parsed = releaseFormInput.safeParse({ name, releaseDate, description });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields");
      return;
    }
    setError(null);
    onConfirm(parsed.data);
  }

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
          <DialogTitle>{mode === "create" ? "Create release" : `Edit ${initial.name}`}</DialogTitle>
          <DialogDescription>
            A version issues can be fixed in, e.g. “api-v1.4”. Names are unique per project.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>Name</Label>
          <Input
            id={ids.name}
            ref={nameRef}
            value={name}
            maxLength={RELEASE_NAME_MAX}
            aria-required="true"
            autoComplete="off"
            aria-describedby={error ? ids.error : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.date}>Target date</Label>
          <Input
            id={ids.date}
            type="date"
            className="w-44"
            value={releaseDate}
            onChange={(event) => setReleaseDate(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.description}>Description</Label>
          <textarea
            id={ids.description}
            value={description}
            rows={3}
            maxLength={RELEASE_DESCRIPTION_MAX}
            placeholder="What ships in it (optional)"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setDescription(event.target.value)}
          />
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
          <Button type="submit">{mode === "create" ? "Create release" : "Save"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * REL-1 delete: an unreleased release without issues is just deleted; with issues the
 * dialog offers to unset the fix version on them first (one action, all or nothing).
 */
export function DeleteReleaseDialog({
  open,
  onOpenChange,
  release,
  onConfirm,
}: DialogBase & { release: ReleaseSummary; onConfirm: (unsetIssues: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const count = release.total.count;
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
          <DialogTitle>Delete {release.name}?</DialogTitle>
          <DialogDescription>
            {count > 0
              ? `${issues(count)} ${count === 1 ? "has" : "have"} this fix version. Deleting unsets it on ${count === 1 ? "it" : "them"} first; the issues themselves are kept.`
              : "No issues have this fix version."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => onConfirm(count > 0)}>
            {count > 0 ? `Unset on ${issues(count)} and delete` : "Delete release"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OpenChoice = "move" | "keep";

/**
 * REL-1 "Mark released". When issues are still open, it warns and asks: move them to
 * another unreleased release, or release anyway (they keep this fix version).
 */
export function MarkReleasedDialog({
  open,
  onOpenChange,
  release,
  targets,
  onConfirm,
}: DialogBase & {
  release: ReleaseSummary;
  /** The other unreleased releases of the project (where open issues can go). */
  targets: readonly ReleaseSummary[];
  onConfirm: (openIssues: MarkReleasedInput["openIssues"]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        // Mounted per opening, so the choice starts from the current targets every time.
        <MarkReleasedForm
          release={release}
          targets={targets}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}

function MarkReleasedForm({
  release,
  targets,
  onCancel,
  onConfirm,
}: {
  release: ReleaseSummary;
  targets: readonly ReleaseSummary[];
  onCancel: () => void;
  onConfirm: (openIssues: MarkReleasedInput["openIssues"]) => void;
}) {
  const openCount = release.total.count - release.done.count;
  const [choice, setChoice] = useState<OpenChoice>(targets.length > 0 ? "move" : "keep");
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const moveRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLInputElement>(null);
  const ids = { group: useId(), legend: useId(), target: useId(), error: useId() };

  function submit() {
    if (openCount === 0) return onConfirm(undefined);
    if (choice === "keep") return onConfirm({ action: "keep" });
    if (!targetId) {
      setError("Pick the release the open issues move to");
      return;
    }
    onConfirm({ action: "move", targetReleaseId: targetId });
  }

  return (
    <DialogContent
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (openCount === 0) confirmRef.current?.focus();
        // The checked choice (the disabled "move" cannot take focus).
        else (choice === "move" ? moveRef : keepRef).current?.focus();
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
          <DialogTitle>Mark {release.name} released?</DialogTitle>
          <DialogDescription>
            {release.done.count} of {issues(release.total.count)} done. You can reopen it later.
          </DialogDescription>
        </DialogHeader>
        {openCount > 0 ? (
          <fieldset aria-labelledby={ids.legend} className="flex flex-col gap-2">
            <legend id={ids.legend} className="mb-1 text-sm font-medium">
              {issues(openCount)} {openCount === 1 ? "is" : "are"} not done yet.
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                ref={moveRef}
                type="radio"
                name={ids.group}
                value="move"
                disabled={targets.length === 0}
                checked={choice === "move"}
                onChange={() => setChoice("move")}
                className="size-4 accent-primary"
              />
              Move {openCount === 1 ? "it" : "them"} to another release
            </label>
            {choice === "move" && targets.length > 0 ? (
              <div className="ml-6 flex flex-col gap-1.5">
                <Label htmlFor={ids.target} className="sr-only">
                  Target release
                </Label>
                <Select
                  id={ids.target}
                  label="Target release"
                  value={targetId}
                  options={targets.map((target) => ({ value: target.id, label: target.name }))}
                  onChange={setTargetId}
                />
              </div>
            ) : null}
            {targets.length === 0 ? (
              <p className="ml-6 text-xs text-muted-foreground">
                There is no other unreleased release to move them to.
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                ref={keepRef}
                type="radio"
                name={ids.group}
                value="keep"
                checked={choice === "keep"}
                onChange={() => setChoice("keep")}
                className="size-4 accent-primary"
              />
              Release anyway ({openCount === 1 ? "it keeps" : "they keep"} this fix version)
            </label>
          </fieldset>
        ) : null}
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
          <Button ref={confirmRef} type="submit">
            Mark released
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
