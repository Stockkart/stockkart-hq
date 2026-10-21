"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { callAction } from "@/features/issue/client-utils";
import { DIAGRAM_KIND_LABELS, type DiagramKind, DIAGRAM_TITLE_MAX } from "@/lib/diagrams/constants";
import { diagramPath } from "@/lib/diagrams/links";
import { type DiagramTemplateView } from "@/lib/diagrams/views";
import { preloader } from "@/lib/idle";
import { cn } from "@/lib/utils";
import {
  createDiagramAction,
  deleteDiagramAction,
  loadDiagramTemplatesAction,
  renameDiagramAction,
} from "@/server/actions/diagrams";

import { DiagramKindIcon } from "./diagram-thumbnail";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TitleField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Title
      </label>
      <Input
        id={id}
        autoFocus
        value={value}
        maxLength={DIAGRAM_TITLE_MAX}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Built-in templates are seed data: fetched once per page load, when first needed. */
const loadTemplates = preloader(async () => {
  const result = await loadDiagramTemplatesAction();
  if (!result.ok) throw new Error(result.error);
  return result.data;
});

/** DGM-1/2 "New whiteboard" / "New flow", or DGM-3 "New from template" (`kind = null`). */
export function NewDiagramDialog({
  open,
  onOpenChange,
  projectKey,
  kind,
}: DialogProps & { projectKey: string; kind: DiagramKind | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [templates, setTemplates] = useState<DiagramTemplateView[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DiagramTemplateView | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { title: useId(), templates: useId() };
  const fromTemplate = kind === null;

  useEffect(() => {
    if (!open || !fromTemplate || templates) return;
    let live = true;
    loadTemplates().then(
      (list) => {
        if (live) setTemplates(list);
      },
      () => {
        if (live) setTemplateError("Templates could not be loaded. Try again.");
      },
    );
    return () => {
      live = false;
    };
  }, [open, fromTemplate, templates]);

  function choose(template: DiagramTemplateView) {
    // The title follows the template until the person types one of their own.
    if (!title.trim() || title === selected?.name) setTitle(template.name);
    setSelected(template);
  }

  function submit() {
    if (fromTemplate && !selected) return;
    startTransition(async () => {
      const created = await callAction(() =>
        createDiagramAction({
          projectKey,
          title,
          kind: selected?.kind ?? kind ?? "whiteboard",
          templateId: selected?.id ?? null,
        }),
      );
      if (!created) return;
      onOpenChange(false);
      setTitle("");
      setSelected(null);
      router.push(diagramPath(projectKey, created.id));
    });
  }

  const heading = fromTemplate
    ? "New from template"
    : `New ${DIAGRAM_KIND_LABELS[kind].toLowerCase()}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={fromTemplate ? "sm:max-w-lg" : "sm:max-w-md"}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
            <DialogDescription>
              {fromTemplate
                ? "Pick a starting point; you can change everything afterwards."
                : kind === "whiteboard"
                  ? "A free-form Excalidraw board: boxes, arrows, text and freehand."
                  : "A node graph: typed nodes, labelled edges and auto-layout."}
            </DialogDescription>
          </DialogHeader>
          {fromTemplate ? (
            <fieldset className="flex flex-col gap-1">
              <legend id={ids.templates} className="mb-1 text-sm font-medium">
                Template
              </legend>
              {templateError ? (
                <p role="alert" className="text-sm text-destructive">
                  {templateError}
                </p>
              ) : templates === null ? (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Loading templates…
                </p>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No diagram templates yet. Run the seed (pnpm db:seed) to add the built-ins.
                </p>
              ) : (
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {templates.map((template) => (
                    <label
                      key={template.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                        selected?.id === template.id && "border-primary bg-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name={ids.templates}
                        className="sr-only"
                        checked={selected?.id === template.id}
                        onChange={() => choose(template)}
                      />
                      <DiagramKindIcon kind={template.kind} className="mt-0.5 size-4 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">
                          {template.name}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {DIAGRAM_KIND_LABELS[template.kind]}
                          </span>
                        </span>
                        {template.description ? (
                          <span className="text-xs text-muted-foreground">
                            {template.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          ) : null}
          <TitleField id={ids.title} value={title} onChange={setTitle} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={pending || !title.trim() || (fromTemplate && !selected)}
            >
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rename from the list (optimistic: `onRenamed` shows it at once, `onFailed` rolls back). */
export function RenameDiagramDialog({
  open,
  onOpenChange,
  diagram,
  onRenamed,
  onFailed,
}: DialogProps & {
  diagram: { id: string; title: string };
  onRenamed: (title: string) => void;
  onFailed: () => void;
}) {
  const [title, setTitle] = useState(diagram.title);
  const titleId = useId();
  const [seen, setSeen] = useState(diagram.title);
  if (seen !== diagram.title) {
    setSeen(diagram.title);
    setTitle(diagram.title);
  }

  async function submit() {
    const next = title.replace(/\s+/g, " ").trim();
    if (!next || next === diagram.title) {
      onOpenChange(false);
      return;
    }
    onRenamed(next);
    onOpenChange(false);
    const result = await callAction(() =>
      renameDiagramAction({ diagramId: diagram.id, title: next }),
    );
    if (result === null) onFailed();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename diagram</DialogTitle>
            <DialogDescription>An open editor of it will offer to reload.</DialogDescription>
          </DialogHeader>
          <TitleField id={titleId} value={title} onChange={setTitle} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!title.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Soft delete (it can come back from the trash once that exists). */
export function DeleteDiagramDialog({
  open,
  onOpenChange,
  diagram,
  onDeleted,
  onFailed,
}: DialogProps & {
  diagram: { id: string; title: string };
  /** Called at once (optimistic); `onFailed` if the server refuses. */
  onDeleted: () => void;
  onFailed: () => void;
}) {
  async function confirm() {
    onDeleted();
    onOpenChange(false);
    const result = await callAction(() => deleteDiagramAction({ diagramId: diagram.id }));
    if (result === null) onFailed();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{diagram.title}”?</DialogTitle>
          <DialogDescription>
            It disappears from the list, search and doc embeds. Its history is kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={() => void confirm()}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
