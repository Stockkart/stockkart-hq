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
import { Select } from "@/components/ui/select";
import { LazyRichTextEditor, preloadRichTextEditor } from "@/features/editor/lazy-rich-text-editor";
import {
  DEFAULT_PRIORITY,
  ISSUE_TYPES,
  type IssueType,
  type Priority,
} from "@/lib/issues/constants";
import { whenIdle } from "@/lib/idle";
import { matchesShortcut } from "@/features/shell/shortcuts";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { TITLE_MAX } from "@/lib/issues/schemas";
import { isEmptyDoc, type RichTextDoc } from "@/lib/rich-text";
import { type SprintOption } from "@/lib/sprints/views";
import { createIssueAction, loadIssueTemplatesAction } from "@/server/actions/issues";
import { promoteTodoAction } from "@/server/actions/todos";

import { priorityOptions, sprintOptions, typeOptions } from "./field-options";
import { shouldIgnoreShortcut } from "./keyboard";
import {
  isQuickCreateEvent,
  QUICK_CREATE_EVENT,
  type QuickCreateRequest,
} from "./quick-create-events";

/** Subtasks need a parent, so they are created from the parent issue instead. */
const QUICK_CREATE_TYPES = ISSUE_TYPES.filter((type) => type !== "subtask");
const TYPE_OPTIONS = typeOptions(QUICK_CREATE_TYPES);
const PRIORITY_OPTIONS = priorityOptions();

interface QuickCreateProps {
  /** Project used when the current page is not inside one. */
  defaultProjectKey: string;
  /** Templates loaded with the page; without them they are fetched once, on idle. */
  initialTemplates?: Partial<Record<IssueType, RichTextDoc>>;
  /** BLG-3: open sprints per project key, loaded with the page (no request on open). */
  sprintOptionsByProject?: Record<string, SprintOption[]>;
}

/**
 * ISS-4 quick create: the "+ Create" button and the global `C` shortcut (ignored while typing
 * in a field). Only the title is required; type and priority are inline, and picking a type
 * pre-fills the description from its template (ISS-10) unless the description was edited.
 *
 * Other client code opens it pre-filled with `openQuickCreate()` (⌘K "Create bug", MY-3
 * "Promote to issue"); a promote request creates through `promoteTodoAction` instead.
 */
export function QuickCreate({
  defaultProjectKey,
  initialTemplates,
  sprintOptionsByProject,
}: QuickCreateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<Priority>(DEFAULT_PRIORITY);
  const [sprintId, setSprintId] = useState<string | null>(null);
  // Starts from the default type's template when the templates came with the page.
  const [description, setDescription] = useState<RichTextDoc | null>(
    initialTemplates?.task ?? null,
  );
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  // Bumped to remount the editor with new initial content (template switch, reset).
  const [editorKey, setEditorKey] = useState(0);
  const [templates, setTemplates] = useState<Partial<Record<IssueType, RichTextDoc>> | null>(
    initialTemplates ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  // The pending `openQuickCreate()` request (promote target, callback); cleared on close.
  const request = useRef<Omit<QuickCreateRequest, "title" | "type">>({});
  const [promoting, setPromoting] = useState(false);
  const ids = {
    title: useId(),
    type: useId(),
    priority: useId(),
    sprint: useId(),
    description: useId(),
  };

  // On /XYZ/... pages, create in project XYZ; elsewhere use the default project.
  const pathKey = pathname.split("/")[1] ?? "";
  const projectKey = PROJECT_KEY_PATTERN.test(pathKey) ? pathKey : defaultProjectKey;
  const sprints = sprintOptionsByProject?.[projectKey] ?? [];
  // A pick from another project's list (the user navigated) falls back to the backlog.
  const sprint = sprints.some((option) => option.id === sprintId) ? sprintId : null;

  // Latest values for the async template load below.
  const current = useRef({
    type,
    descriptionEdited,
    templatesRequested: initialTemplates !== undefined,
  });
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

  /**
   * Fetches the templates once. Called when the browser is idle after the page loads and
   * when the pointer or focus reaches "Create", so opening the dialog needs no network.
   */
  const preload = useCallback(() => {
    void preloadRichTextEditor().catch(() => {});
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

  useEffect(() => whenIdle(preload), [preload]);

  /** Opens at once; the templates are normally there already (see `preload`). */
  const openDialog = useCallback(() => {
    setOpen(true);
    preload();
  }, [preload]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut(event, "create") || shouldIgnoreShortcut(event)) return;
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
    setSprintId(null);
    setDescription(null);
    setDescriptionEdited(false);
    setEditorKey((key) => key + 1);
    setError(null);
  }, []);

  // `openQuickCreate()` requests: start from a clean form with the requested title and type.
  useEffect(() => {
    function onRequest(event: Event) {
      if (!isQuickCreateEvent(event)) return;
      const { title: requestedTitle = "", type: requestedType, ...rest } = event.detail;
      const nextType = QUICK_CREATE_TYPES.find((t) => t === requestedType) ?? "task";
      reset();
      request.current = rest;
      setPromoting(Boolean(rest.promoteTodoId));
      setTitle(requestedTitle.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX));
      setType(nextType);
      // `reset` cleared these in state; the refs catch up on the next render, prefill now.
      current.current.type = nextType;
      current.current.descriptionEdited = false;
      prefill(nextType, templates);
      openDialog();
    }
    window.addEventListener(QUICK_CREATE_EVENT, onRequest);
    return () => window.removeEventListener(QUICK_CREATE_EVENT, onRequest);
  }, [openDialog, prefill, reset, templates]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // A request is for one dialog session: a later plain `C` must not promote the todo.
      request.current = {};
      setPromoting(false);
    }
  }

  function submit() {
    if (pending) return;
    if (!title.trim()) {
      setError("Title is required");
      titleRef.current?.focus();
      return;
    }
    setError(null);
    const { promoteTodoId, onCreated } = request.current;
    startTransition(async () => {
      const fields = {
        projectKey,
        title,
        type,
        priority,
        // BLG-3: only when one was picked (omitted = the backlog).
        ...(sprint ? { sprintId: sprint } : {}),
        description: description && !isEmptyDoc(description) ? description : null,
      };
      const result = promoteTodoId
        ? await promoteTodoAction({ ...fields, todoId: promoteTodoId })
        : await createIssueAction(fields);
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
      onCreated?.(result.data);
      reset();
      onOpenChange(false);
      // No router.refresh(): the action re-renders the open page in its own response.
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openDialog}
        onPointerEnter={preload}
        onFocus={preload}
        aria-keyshortcuts="C"
      >
        <Plus aria-hidden="true" />
        Create
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
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
              <DialogTitle>
                {promoting ? "Promote todo to an issue" : "Create issue"} in {projectKey}
              </DialogTitle>
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
                <Select
                  id={ids.type}
                  label="Type"
                  value={type}
                  options={TYPE_OPTIONS}
                  onChange={(next) => {
                    if (!next) return;
                    setType(next);
                    prefill(next, templates);
                  }}
                />
              </div>
              <div className="flex min-w-36 flex-col gap-1.5">
                <Label htmlFor={ids.priority}>Priority</Label>
                <Select
                  id={ids.priority}
                  label="Priority"
                  value={priority}
                  options={PRIORITY_OPTIONS}
                  onChange={(next) => {
                    if (next !== null) setPriority(next);
                  }}
                />
              </div>
              <div className="flex min-w-36 flex-col gap-1.5">
                <Label htmlFor={ids.sprint}>Sprint</Label>
                <Select
                  id={ids.sprint}
                  label="Sprint"
                  value={sprint}
                  options={sprintOptions(sprints)}
                  clearLabel="Backlog"
                  placeholder="Backlog"
                  onChange={setSprintId}
                />
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
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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
