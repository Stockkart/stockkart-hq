"use client";

import { Pin, PinOff } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { type DocTreeItem } from "@/lib/docs/views";

import { DocTree } from "./doc-tree";

/**
 * The doc page's page tree (DOC-2), out of the way of the content: a "Pages" drawer (the
 * default; `[` opens it) with search-as-you-type, or, for people who pin it, a narrow
 * resizable column. The pin and the width are remembered per browser (`localStorage`);
 * the server render and the first client render are unpinned, so hydration never
 * mismatches. Below 1024 px the tree is always the drawer.
 */

export const PAGES_STORAGE_KEY = "hq.docs.pages";
const EVENT = "hq:docs-pages";
export const PAGES_WIDTH = { min: 200, max: 400, default: 240, step: 16 } as const;

export interface PagesPreference {
  pinned: boolean;
  width: number;
}

const DEFAULT_PREFERENCE: PagesPreference = { pinned: false, width: PAGES_WIDTH.default };

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return PAGES_WIDTH.default;
  return Math.round(Math.min(PAGES_WIDTH.max, Math.max(PAGES_WIDTH.min, width)));
}

/** The stored preference; anything unreadable is the default. */
export function parsePreference(value: string | null): PagesPreference {
  if (!value) return DEFAULT_PREFERENCE;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFERENCE;
    const pinned = "pinned" in parsed && parsed.pinned === true;
    const width = "width" in parsed && typeof parsed.width === "number" ? parsed.width : NaN;
    return { pinned, width: clampWidth(width) };
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function read(): string {
  try {
    return window.localStorage.getItem(PAGES_STORAGE_KEY) ?? "";
  } catch {
    // Storage blocked (privacy mode): the defaults apply.
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePagesPreference(): PagesPreference & {
  update: (patch: Partial<PagesPreference>) => void;
} {
  const stored = useSyncExternalStore(subscribe, read, () => "");
  const preference = parsePreference(stored);
  const update = useCallback((patch: Partial<PagesPreference>) => {
    const next = { ...parsePreference(read()), ...patch };
    try {
      window.localStorage.setItem(
        PAGES_STORAGE_KEY,
        JSON.stringify({ pinned: next.pinned, width: clampWidth(next.width) }),
      );
    } catch {
      // Not stored; nothing else to do.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { ...preference, update };
}

/** The search box above the tree; ↓ moves into the tree, Enter opens the first match. */
function PagesSearch({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        Search pages
      </label>
      <Input
        id={id}
        ref={inputRef}
        type="search"
        placeholder="Search pages…"
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          const root = event.currentTarget.closest("[data-pages-nav]");
          const first = root?.querySelector<HTMLElement>("a[data-tree-link]");
          if (event.key === "ArrowDown" && first) {
            event.preventDefault();
            first.focus();
          } else if (event.key === "Enter" && value.trim() && first) {
            event.preventDefault();
            first.click();
          }
        }}
      />
    </div>
  );
}

export function PagesDrawer({
  open,
  onOpenChange,
  projectKey,
  docs,
  onPin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectKey: string;
  docs: DocTreeItem[];
  /** Docks the tree as a column (hidden below 1024 px, where the drawer stays). */
  onPin: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <SheetContent side="left" aria-describedby={undefined} data-pages-nav="">
        <div className="flex items-center gap-2 pr-8">
          <SheetTitle>Pages</SheetTitle>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto hidden lg:inline-flex"
            title="Keep the page tree open beside the doc"
            onClick={onPin}
          >
            <Pin aria-hidden="true" />
            Pin
          </Button>
        </div>
        <PagesSearch value={query} onChange={setQuery} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DocTree
            projectKey={projectKey}
            docs={docs}
            query={query}
            onNavigate={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PinnedPages({
  projectKey,
  docs,
  width,
  onResize,
  onUnpin,
  searchRef,
}: {
  projectKey: string;
  docs: DocTreeItem[];
  width: number;
  onResize: (width: number) => void;
  onUnpin: () => void;
  searchRef?: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const shown = dragWidth ?? width;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let last = startWidth;
    const move = (moved: globalThis.PointerEvent) => {
      last = clampWidth(startWidth + moved.clientX - startX);
      setDragWidth(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragWidth(null);
      onResize(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  return (
    <div
      className="sticky top-6 hidden max-h-[calc(100dvh-6rem)] shrink-0 self-start lg:flex"
      style={{ width: shown }}
      data-pages-nav=""
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden pr-2">
        <div className="flex items-center gap-1">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Pages
          </h2>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7"
            title="Unpin: open the tree from the Pages button"
            onClick={onUnpin}
          >
            <PinOff aria-hidden="true" />
            Unpin
          </Button>
        </div>
        <PagesSearch value={query} onChange={setQuery} inputRef={searchRef} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DocTree projectKey={projectKey} docs={docs} query={query} />
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the page tree"
        aria-valuemin={PAGES_WIDTH.min}
        aria-valuemax={PAGES_WIDTH.max}
        aria-valuenow={shown}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(event) => {
          const steps: Record<string, number> = {
            ArrowLeft: width - PAGES_WIDTH.step,
            ArrowRight: width + PAGES_WIDTH.step,
            Home: PAGES_WIDTH.min,
            End: PAGES_WIDTH.max,
          };
          const next = steps[event.key];
          if (next === undefined) return;
          event.preventDefault();
          onResize(clampWidth(next));
        }}
        className="w-1.5 shrink-0 cursor-col-resize rounded-full bg-border/60 outline-none hover:bg-ring/60 focus-visible:bg-ring"
      />
    </div>
  );
}
