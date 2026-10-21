"use client";

import {
  ArrowRight,
  Bug,
  CircleDot,
  FileCheck2,
  FilePlus2,
  FileText,
  type LucideIcon,
  MessageSquare,
  Network,
  Plus,
  Search,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NewAdrDialog, NewDocDialog } from "@/features/docs/doc-dialogs";
import { openQuickCreate } from "@/features/issue/quick-create-events";
import { type IssueType } from "@/lib/issues/constants";
import { issuePathForKey, parseIssueKey, PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import {
  EMPTY_RESULTS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_QUERY_MAX,
  type SearchHit,
  type SearchResults,
} from "@/lib/search/schemas";
import { type Snippet, snippetParts } from "@/lib/search/snippet";
import { cn } from "@/lib/utils";
import { searchAction } from "@/server/actions/search";

type Option =
  | { id: string; kind: "go"; label: string; detail: string | null; href: string; icon: LucideIcon }
  | { id: string; kind: "hit"; hit: SearchHit; icon: LucideIcon }
  | { id: string; kind: "create"; label: string; type: IssueType; icon: LucideIcon }
  | { id: string; kind: "newDoc"; label: string; dialog: DocDialog; icon: LucideIcon };

/** The slice 3 docs dialogs the palette can open: "New page" (DOC-2) and "New ADR" (ADR-1). */
type DocDialog = "doc" | "adr";

interface Group {
  id: string;
  label: string;
  options: Option[];
}

const HIT_ICONS: Record<SearchHit["kind"], LucideIcon> = {
  issue: CircleDot,
  doc: FileText,
  diagram: Network,
  comment: MessageSquare,
};

/** SRCH-3-style actions, always available; filtered by the query. */
function staticActions(projectKey: string): Option[] {
  const go = (label: string, href: string): Option => ({
    id: `go:${href}`,
    kind: "go",
    label,
    detail: null,
    href,
    icon: ArrowRight,
  });
  return [
    { id: "create:task", kind: "create", label: "Create issue", type: "task", icon: Plus },
    { id: "create:bug", kind: "create", label: "Create bug", type: "bug", icon: Bug },
    { id: "new:doc", kind: "newDoc", label: "New doc", dialog: "doc", icon: FilePlus2 },
    { id: "new:adr", kind: "newDoc", label: "New ADR", dialog: "adr", icon: FileCheck2 },
    go("Go to Backlog", `/${projectKey}/backlog`),
    go("Go to Board", `/${projectKey}/board`),
    go("Go to Issues", `/${projectKey}/issues`),
    go("Go to Docs", `/${projectKey}/docs`),
    go("Go to ADRs", `/${projectKey}/adrs`),
    go("Go to Diagrams", `/${projectKey}/diagrams`),
    go("Go to My Work", "/my-work"),
    go("Go to Todos", "/todos"),
  ];
}

function optionLabel(option: Option): string {
  return option.kind === "hit" ? option.hit.title : option.label;
}

/** On `/XYZ/…` pages the "Go to" actions target project XYZ (like quick create). */
function projectKeyFromPath(pathname: string, fallback: string): string {
  const segment = pathname.split("/")[1] ?? "";
  return PROJECT_KEY_PATTERN.test(segment) ? segment : fallback;
}

/**
 * SRCH-1/2 ⌘K command palette (SPEC §5.7). Cmd/Ctrl+K toggles it from anywhere in the app,
 * even while typing (it is a chord, not a single key). WAI-ARIA combobox: focus stays in
 * the input, ↑/↓ move the active option (`aria-activedescendant`), Enter runs it, Esc
 * closes. `STK-123` offers a direct jump at once; other text is searched after a short
 * pause (debounced), and responses to older queries are dropped.
 */
export function CommandPalette({ defaultProjectKey }: { defaultProjectKey: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; data: SearchResults } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [docDialog, setDocDialog] = useState<DocDialog | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const ids = { input: useId(), listbox: useId(), status: useId() };
  // For the window listener: the latest open state and the close/reset logic.
  const openRef = useRef(open);
  const toggleRef = useRef(() => {});
  useEffect(() => {
    openRef.current = open;
    toggleRef.current = () => onOpenChange(!openRef.current);
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      toggleRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      if (timer.current) clearTimeout(timer.current);
      sequence.current += 1; // drop any in-flight response
      setQuery("");
      setResults(null);
      setError(null);
      setActiveIndex(0);
    }
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setActiveIndex(0);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    const trimmed = value.replace(/\s+/g, " ").trim();
    const id = (sequence.current += 1);
    if (!trimmed) return;
    timer.current = setTimeout(() => {
      searchAction({ q: trimmed })
        .then((result) => {
          if (id !== sequence.current) return; // a newer query is on its way
          if (result.ok) setResults({ query: trimmed, data: result.data });
          else setError(result.error);
        })
        .catch(() => {
          if (id === sequence.current) setError("Search failed. Try again.");
        });
    }, SEARCH_DEBOUNCE_MS);
  }

  const trimmed = query.replace(/\s+/g, " ").trim();
  // Only results for exactly this text: while a newer query is pending, older hits are
  // hidden, so Enter can never open a result of a previous query.
  const current = results && results.query === trimmed ? results.data : null;
  const data = trimmed ? (current ?? EMPTY_RESULTS) : EMPTY_RESULTS;
  const projectKey = projectKeyFromPath(pathname, defaultProjectKey);

  const groups: Group[] = [];
  // `STK-123` jumps directly: offered before the server answers, dropped if it says no.
  const ref = parseIssueKey(trimmed);
  if (ref && !(current && current.jump === null)) {
    const key = `${ref.projectKey}-${ref.number}`;
    groups.push({
      id: "jump",
      label: "Go to issue",
      options: [
        {
          id: `jump:${key}`,
          kind: "go",
          label: current?.jump ? `${current.jump.key} ${current.jump.title}` : `Go to ${key}`,
          detail: null,
          href: current?.jump?.href ?? issuePathForKey(key),
          icon: ArrowRight,
        },
      ],
    });
  }
  const hitGroups: [string, string, SearchHit[]][] = [
    ["issues", "Issues", data.issues],
    ["docs", "Docs", data.docs],
    ["diagrams", "Diagrams", data.diagrams],
    ["comments", "Comments", data.comments],
  ];
  for (const [id, label, hits] of hitGroups) {
    if (hits.length === 0) continue;
    groups.push({
      id,
      label,
      options: hits.map((hit) => ({
        id: `${hit.kind}:${hit.id}`,
        kind: "hit",
        hit,
        icon: HIT_ICONS[hit.kind],
      })),
    });
  }
  const needle = trimmed.toLowerCase();
  const actions = staticActions(projectKey).filter(
    (option) => !needle || optionLabel(option).toLowerCase().includes(needle),
  );
  if (actions.length > 0) groups.push({ id: "actions", label: "Actions", options: actions });

  const options = groups.flatMap((group) => group.options);
  const active = Math.min(activeIndex, Math.max(0, options.length - 1));
  const optionId = (index: number) => `${ids.listbox}-option-${index}`;
  const searching = Boolean(trimmed) && !current && !error && !ref;
  const activeId = options.length > 0 ? optionId(active) : null;

  // aria-activedescendant moves no real focus, so keep the active option in view.
  useEffect(() => {
    if (!activeId) return;
    const element = document.getElementById(activeId);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  // Prefetch where Enter would go, so the page shell is there the moment it is chosen
  // (palette choices navigate with router.push: they are options, not links).
  const activeOption = options[active];
  const activeHref =
    activeOption?.kind === "hit"
      ? activeOption.hit.href
      : activeOption?.kind === "go"
        ? activeOption.href
        : null;
  useEffect(() => {
    if (activeHref) router.prefetch(activeHref);
  }, [activeHref, router]);

  function run(option: Option | undefined) {
    if (!option) return;
    onOpenChange(false);
    if (option.kind === "create") {
      // Let this dialog close (and return focus) before the quick-create dialog opens.
      setTimeout(() => openQuickCreate({ type: option.type }), 0);
      return;
    }
    if (option.kind === "newDoc") {
      // Same here: the docs dialog opens once this one has closed.
      const dialog = option.dialog;
      setTimeout(() => setDocDialog(dialog), 0);
      return;
    }
    router.push(option.kind === "hit" ? option.hit.href : option.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Enter during IME composition confirms the composition, not an option.
    if (options.length === 0 || event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((active + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((active - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        run(options[active]);
        break;
    }
  }

  // Flat option index where each group starts (options are numbered across groups).
  const starts = groups.map((_, i) =>
    groups.slice(0, i).reduce((count, group) => count + group.options.length, 0),
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border px-1 font-mono text-xs">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-0 p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Search or jump to</DialogTitle>
          <DialogDescription className="sr-only">
            Type to search issues, docs, diagrams and comments, or an issue key such as STK-12. Use
            the arrow keys to choose and Enter to open.
          </DialogDescription>
          <div className="flex items-center gap-2 border-b px-3">
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
            <input
              id={ids.input}
              role="combobox"
              aria-label="Search or jump to"
              aria-expanded="true"
              aria-controls={ids.listbox}
              aria-autocomplete="list"
              aria-activedescendant={options.length > 0 ? optionId(active) : undefined}
              aria-describedby={ids.status}
              autoComplete="off"
              spellCheck={false}
              maxLength={SEARCH_QUERY_MAX}
              placeholder="Search or jump to… (try STK-12)"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <p id={ids.status} aria-live="polite" className="sr-only">
            {error ??
              (searching
                ? "Searching…"
                : `${options.length} ${options.length === 1 ? "result" : "results"}`)}
          </p>
          <div
            id={ids.listbox}
            role="listbox"
            aria-label="Results"
            className="max-h-[60dvh] overflow-y-auto p-2"
          >
            {groups.map((group, groupIndex) => (
              <div key={group.id} role="group" aria-labelledby={`${ids.listbox}-${group.id}`}>
                <div
                  id={`${ids.listbox}-${group.id}`}
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                >
                  {group.label}
                </div>
                {group.options.map((option, optionIndex) => {
                  const position = (starts[groupIndex] ?? 0) + optionIndex;
                  const Icon = option.icon;
                  const selected = position === active;
                  return (
                    <div
                      key={option.id}
                      id={optionId(position)}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActiveIndex(position)}
                      // Keep focus in the input (combobox pattern); run on click.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => run(option)}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm",
                        selected && "bg-accent text-accent-foreground",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{optionLabel(option)}</span>
                        {option.kind === "hit" && option.hit.snippet ? (
                          <HighlightedSnippet snippet={option.hit.snippet} />
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {current && options.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>
            ) : null}
            {error ? <p className="px-2 py-2 text-sm text-destructive">{error}</p> : null}
          </div>
        </DialogContent>
      </Dialog>
      {/* The docs dialogs create the doc in the current project and open it. */}
      <NewDocDialog
        open={docDialog === "doc"}
        onOpenChange={(isOpen) => setDocDialog(isOpen ? "doc" : null)}
        projectKey={projectKey}
      />
      <NewAdrDialog
        open={docDialog === "adr"}
        onOpenChange={(isOpen) => setDocDialog(isOpen ? "adr" : null)}
        projectKey={projectKey}
      />
    </>
  );
}

/**
 * A search snippet as React text with `<mark>` around the matches. Only text nodes are
 * created, so whatever the stored text contains is displayed, never interpreted (S-8).
 */
export function HighlightedSnippet({ snippet }: { snippet: Snippet }) {
  return (
    <span className="line-clamp-2 text-xs text-muted-foreground">
      {snippetParts(snippet).map((part, i) =>
        part.highlight ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-200/70 text-foreground dark:bg-yellow-500/30"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
