"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

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
import { NativeSelect } from "@/components/ui/native-select";
import { RichTextView } from "@/features/editor/rich-text-view";
import { callAction } from "@/features/issue/client-utils";
import { DOC_TYPE_LABELS, type DocType, PICKABLE_DOC_TYPES } from "@/lib/docs/constants";
import { DOC_TITLE_MAX } from "@/lib/docs/schemas";
import { buildTree, descendantIds, flattenTree, siblingsOf } from "@/lib/docs/tree";
import { docPath, type DocTemplateView, type DocTreeItem } from "@/lib/docs/views";
import { cn } from "@/lib/utils";
import {
  createAdrAction,
  createDocAction,
  deleteDocAction,
  loadDocTemplatesAction,
  moveDocAction,
  renameDocAction,
} from "@/server/actions/docs";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TitleField({
  id,
  value,
  onChange,
  label = "Title",
  maxLength = DOC_TITLE_MAX,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  maxLength?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        autoFocus
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** DOC-2 "New page" (optionally under a parent). */
export function NewDocDialog({
  open,
  onOpenChange,
  projectKey,
  parent,
}: DialogProps & { projectKey: string; parent?: { id: string; title: string } | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocType>("page");
  const [pending, startTransition] = useTransition();
  const ids = { title: useId(), type: useId() };

  function submit() {
    startTransition(async () => {
      const created = await callAction(() =>
        createDocAction({ projectKey, title, type, parentId: parent?.id ?? null }),
      );
      if (!created) return;
      onOpenChange(false);
      setTitle("");
      router.push(docPath(projectKey, created.id));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{parent ? `New page in “${parent.title}”` : "New page"}</DialogTitle>
            <DialogDescription>Start blank, or use “New from template”.</DialogDescription>
          </DialogHeader>
          <TitleField id={ids.title} value={title} onChange={setTitle} />
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.type} className="text-sm font-medium">
              Type
            </label>
            <NativeSelect
              id={ids.type}
              value={type}
              onChange={(event) => {
                const next = PICKABLE_DOC_TYPES.find((value) => value === event.target.value);
                if (next) setType(next);
              }}
            >
              {PICKABLE_DOC_TYPES.map((value) => (
                <option key={value} value={value}>
                  {DOC_TYPE_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** ADR-1 "New ADR": the server numbers it and applies the ADR template. */
export function NewAdrDialog({
  open,
  onOpenChange,
  projectKey,
}: DialogProps & { projectKey: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const titleId = useId();

  function submit() {
    startTransition(async () => {
      const created = await callAction(() => createAdrAction({ projectKey, title }));
      if (!created) return;
      onOpenChange(false);
      setTitle("");
      toast.success(`Created ${created.title}`);
      router.push(docPath(projectKey, created.id));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New ADR</DialogTitle>
            <DialogDescription>
              It gets the next number and the ADR template, with status Proposed.
            </DialogDescription>
          </DialogHeader>
          <TitleField
            id={titleId}
            label="Decision title"
            value={title}
            onChange={setTitle}
            maxLength={DOC_TITLE_MAX - 6}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create ADR"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** DOC-5 "New from template": pick a template, preview it, name the doc. */
export function TemplatePickerDialog({
  open,
  onOpenChange,
  projectKey,
  projectKeys,
}: DialogProps & { projectKey: string; projectKeys: string[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<DocTemplateView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const ids = { title: useId(), list: useId(), preview: useId() };

  useEffect(() => {
    if (!open || templates !== null) return;
    let cancelled = false;
    void callAction(() => loadDocTemplatesAction()).then((loaded) => {
      if (cancelled || !loaded) return;
      setTemplates(loaded);
      setSelectedId((current) => current ?? loaded[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, templates]);

  const selected = templates?.find((template) => template.id === selectedId) ?? null;

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      // The ADR template goes through "New ADR" so the doc gets its number (ADR-1).
      const created =
        selected.subtype === "adr"
          ? await callAction(() => createAdrAction({ projectKey, title }))
          : await callAction(() => createDocAction({ projectKey, title, templateId: selected.id }));
      if (!created) return;
      onOpenChange(false);
      setTitle("");
      router.push(docPath(projectKey, created.id));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New from template</DialogTitle>
            <DialogDescription>The new doc starts as a copy of the template.</DialogDescription>
          </DialogHeader>
          {templates === null ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Loading templates…
            </p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates yet. Run the seed to add the built-in ones.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
              <fieldset className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
                <legend id={ids.list} className="mb-1 text-sm font-medium">
                  Template
                </legend>
                {templates.map((template) => (
                  <label
                    key={template.id}
                    className={cn(
                      "flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm hover:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                      template.id === selectedId && "bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="template"
                        value={template.id}
                        checked={template.id === selectedId}
                        onChange={() => setSelectedId(template.id)}
                        className="sr-only"
                      />
                      <span className="font-medium">{template.name}</span>
                    </span>
                    {template.description ? (
                      <span className="text-xs text-muted-foreground">{template.description}</span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
              <section
                aria-labelledby={ids.preview}
                className="max-h-96 overflow-y-auto rounded-md border p-3"
              >
                <h3 id={ids.preview} className="mb-2 text-xs font-medium text-muted-foreground">
                  Preview{selected ? `: ${selected.name}` : ""}
                </h3>
                {selected ? (
                  <RichTextView doc={selected.content} projectKeys={projectKeys} />
                ) : null}
              </section>
            </div>
          )}
          <TitleField id={ids.title} value={title} onChange={setTitle} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !title.trim() || !selected}>
              {pending ? "Creating…" : "Create doc"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDocDialog({
  open,
  onOpenChange,
  doc,
}: DialogProps & { doc: { id: string; title: string } }) {
  const [title, setTitle] = useState(doc.title);
  const [pending, startTransition] = useTransition();
  const titleId = useId();

  function submit() {
    startTransition(async () => {
      const result = await callAction(() => renameDocAction({ docId: doc.id, title }));
      if (!result) return;
      onOpenChange(false);
      // No router.refresh(): the action already re-rendered this page in its response.
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename page</DialogTitle>
            <DialogDescription>Anyone editing it will be asked to reload.</DialogDescription>
          </DialogHeader>
          <TitleField id={titleId} value={title} onChange={setTitle} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !title.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ROOT = "__root__";

/**
 * "Move to…" (DOC-2, §9.5): the keyboard alternative to drag and drop. The parent list
 * leaves out the doc and everything below it (the server checks this again).
 */
export function MoveDocDialog({
  open,
  onOpenChange,
  doc,
  docs,
}: DialogProps & { doc: DocTreeItem; docs: DocTreeItem[] }) {
  const [pending, startTransition] = useTransition();
  const ids = { parent: useId(), position: useId() };
  const known = new Set(docs.map((item) => item.id));
  const currentParent = doc.parentId && known.has(doc.parentId) ? doc.parentId : null;
  const [parentId, setParentId] = useState<string | null>(currentParent);
  const currentIndex = siblingsOf(docs, currentParent)
    .map((item) => item.id)
    .indexOf(doc.id);
  const [index, setIndex] = useState(Math.max(0, currentIndex));

  const parents = useMemo(() => {
    const excluded = descendantIds(docs, doc.id);
    excluded.add(doc.id);
    return flattenTree(buildTree(docs)).filter(({ node }) => !excluded.has(node.id));
  }, [docs, doc.id]);
  const siblings = siblingsOf(docs, parentId, doc.id);

  function submit() {
    startTransition(async () => {
      const result = await callAction(() => moveDocAction({ docId: doc.id, parentId, index }));
      if (result === null) return;
      onOpenChange(false);
      // No router.refresh(): the action already re-rendered this page in its response.
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Move “{doc.title}”</DialogTitle>
            <DialogDescription>Its sub-pages move with it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.parent} className="text-sm font-medium">
              Parent
            </label>
            <NativeSelect
              id={ids.parent}
              value={parentId ?? ROOT}
              onChange={(event) => {
                setParentId(event.target.value === ROOT ? null : event.target.value);
                setIndex(0);
              }}
            >
              <option value={ROOT}>Top level</option>
              {parents.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>
                  {`${"\u00a0\u00a0".repeat(depth + 1)}${node.title}`}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.position} className="text-sm font-medium">
              Position
            </label>
            <NativeSelect
              id={ids.position}
              value={String(Math.min(index, siblings.length))}
              onChange={(event) => setIndex(Number(event.target.value))}
            >
              <option value="0">First</option>
              {siblings.map((sibling, i) => (
                <option key={sibling.id} value={String(i + 1)}>
                  After “{sibling.title}”
                </option>
              ))}
            </NativeSelect>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDocDialog({
  open,
  onOpenChange,
  doc,
  childCount,
  parentTitle,
  afterDelete,
}: DialogProps & {
  doc: { id: string; title: string };
  childCount: number;
  parentTitle: string | null;
  /** Where to go afterwards, e.g. the docs list when the open doc was deleted. */
  afterDelete?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{doc.title}”?</DialogTitle>
          <DialogDescription>
            {childCount > 0
              ? `Its ${childCount === 1 ? "sub-page moves" : `${childCount} sub-pages move`} up to ${
                  parentTitle ? `“${parentTitle}”` : "the top level"
                }.`
              : "The page disappears from the tree and the list."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await callAction(() => deleteDocAction({ docId: doc.id }));
                if (result === null) return;
                onOpenChange(false);
                toast.success(`Deleted “${doc.title}”`);
                // Otherwise the action has already re-rendered this page.
                afterDelete?.();
              })
            }
          >
            {pending ? "Deleting…" : "Delete page"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
