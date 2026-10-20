"use client";

import { Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

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
import { NativeSelect } from "@/components/ui/native-select";
import { LazyRichTextEditor } from "@/features/editor/lazy-rich-text-editor";
import {
  DEFAULT_PRIORITY,
  ISSUE_TYPE_LABELS,
  ISSUE_TYPES,
  type IssueType,
  type Priority,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/issues/constants";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { TITLE_MAX } from "@/lib/issues/schemas";
import { isEmptyDoc, type RichTextDoc } from "@/lib/rich-text";
import { createIssueAction, loadIssueTemplatesAction } from "@/server/actions/issues";

import { isTypingTarget } from "./keyboard";

/** Subtasks need a parent, so they are created from the parent issue instead. */
const QUICK_CREATE_TYPES = ISSUE_TYPES.filter((type) => type !== "subtask");

interface QuickCreateProps {
  /** Project used when the current page is not inside one. */
  defaultProjectKey: string;
}

/**
 * ISS-4 quick create: the "+ Create" button and the global `C` shortcut (ignored while typing
 * in a field). Only the title is required; type and priority are inline, and picking a type
 * pre-fills the description from its template (ISS-10) unless the description was edited.
 */
export function QuickCreate({ defaultProjectKey }: QuickCreateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<Priority>(DEFAULT_PRIORITY);
  const [description, setDescription] = useState<RichTextDoc | null>(null);
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  // Bumped to remount the editor with new initial content (template switch, reset).
  const [editorKey, setEditorKey] = useState(0);
  const [templates, setTemplates] = useState<Partial<Record<IssueType, RichTextDoc>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), type: useId(), priority: useId(), description: useId() };

  // On /XYZ/... pages, create in project XYZ; elsewhere use the default project.
  const pathKey = pathname.split("/")[1] ?? "";
  const projectKey = PROJECT_KEY_PATTERN.test(pathKey) ? pathKey : defaultProjectKey;

  // Latest values for the async template load below.
  const current = useRef({ type, descriptionEdited, templatesRequested: false });
  useEffect(() => {
    current.current.type = type;
    current.current.descriptionEdited = descriptionEdited;
  });

  /** Pre-fills the description from the type's template, unless the user edited it. */
  const prefill = useCallback(
    (nextType: IssueType, from: Partial<Record<IssueType, RichTextDoc>> | null) => {
      if (current.current.descriptionEdited || !from) return;
      setDescription(from[nextType] ?? null);
      setEditorKey((key) => key + 1);
    },
    [],
  );

  /** Opens the dialog; templates are fetched once, the first time. */
  const openDialog = useCallback(() => {
    setOpen(true);
    if (current.current.templatesRequested) return;
    current.current.templatesRequested = true;
    loadIssueTemplatesAction()
      .then((result) => {
        const loaded = result.ok ? result.data : {};
        setTemplates(loaded);
        prefill(current.current.type, loaded);
      })
      .catch(() => {
        // Without templates the description just starts empty; retry on the next open.
        current.current.templatesRequested = false;
      });
  }, [prefill]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      event.preventDefault();
      openDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDialog]);

  const reset = useCallback(() => {
    setTitle("");
    setType("task");
    setPriority(DEFAULT_PRIORITY);
    setDescription(null);
    setDescriptionEdited(false);
    setEditorKey((key) => key + 1);
    setError(null);
  }, []);

  function submit() {
    if (pending) return;
    if (!title.trim()) {
      setError("Title is required");
      titleRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createIssueAction({
        projectKey,
        title,
        type,
        priority,
        description: description && !isEmptyDoc(description) ? description : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { key } = result.data;
      const href = `/${projectKey}/issues/${key}`;
      toast.success(`${key} created`, {
        description: title.trim(),
        action: { label: "Open", onClick: () => router.push(href) },
      });
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog} aria-keyshortcuts="C">
        <Plus aria-hidden="true" />
        Create
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Create issue in {projectKey}</DialogTitle>
              <DialogDescription>
                Only the title is required. Press <kbd className="font-mono">⌘/Ctrl+Enter</kbd> to
                create.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.title}>Title</Label>
              <Input
                id={ids.title}
                ref={titleRef}
                value={title}
                maxLength={TITLE_MAX}
                aria-required="true"
                autoComplete="off"
                placeholder="What needs doing?"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${ids.title}-error` : undefined}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-36 flex-col gap-1.5">
                <Label htmlFor={ids.type}>Type</Label>
                <NativeSelect
                  id={ids.type}
                  value={type}
                  onChange={(event) => {
                    const next = QUICK_CREATE_TYPES.find((t) => t === event.target.value);
                    if (!next) return;
                    setType(next);
                    prefill(next, templates);
                  }}
                >
                  {QUICK_CREATE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {ISSUE_TYPE_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex min-w-36 flex-col gap-1.5">
                <Label htmlFor={ids.priority}>Priority</Label>
                <NativeSelect
                  id={ids.priority}
                  value={priority}
                  onChange={(event) => {
                    const next = PRIORITIES.find((p) => String(p) === event.target.value);
                    if (next !== undefined) setPriority(next);
                  }}
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {PRIORITY_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span id={ids.description} className="text-sm font-medium">
                Description
              </span>
              <div aria-labelledby={ids.description} role="group">
                <LazyRichTextEditor
                  key={editorKey}
                  initialContent={description}
                  projectKeys={[projectKey]}
                  label="Description"
                  placeholder="Add details, or leave empty"
                  onChange={(doc) => {
                    setDescription(doc);
                    setDescriptionEdited(true);
                  }}
                  onSubmit={submit}
                />
              </div>
            </div>

            <p
              id={`${ids.title}-error`}
              role="alert"
              aria-live="assertive"
              className="min-h-5 text-sm text-destructive"
            >
              {error}
            </p>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create issue"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
