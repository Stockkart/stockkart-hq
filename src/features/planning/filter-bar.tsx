"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/issues/constants";
import {
  ASSIGNEE_ME,
  ASSIGNEE_NONE,
  EMPTY_FILTERS,
  filtersToSearchParams,
  hasActiveFilters,
  type IssueFilters,
  TEXT_FILTER_MAX,
} from "@/lib/issues/filters";
import { type LabelView, type NamedOption, type StatusOption } from "@/lib/issues/views";

/** Options for the pickers; usually `ProjectMeta`. */
export interface FilterOptions {
  statuses: StatusOption[];
  components: NamedOption[];
  labels: LabelView[];
  users: NamedOption[];
}

interface FilterBarProps {
  filters: IssueFilters;
  options: FilterOptions;
  /** Non-filter params to keep in the URL (sort, group …). */
  preserved?: Record<string, string | undefined>;
  /** Shown next to the filters, e.g. the backlog's "Group by". */
  children?: React.ReactNode;
}

/** Wait after typing in the text filter before updating the URL. */
const TEXT_DEBOUNCE_MS = 300;

/** The text as `parseIssueFilters` will read it back from the URL. */
const normalise = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * VW-1/VW-2 (and BLG-5) filter bar, shared by the issue list and the backlog. All state is
 * in the URL: every change replaces the query string, the server component re-renders with
 * the parsed filters, and the link can be shared as is.
 */
export function FilterBar({ filters, options, preserved = {}, children }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // Shown at once while the new URL renders, so quick toggles never flicker back.
  const [shown, showOptimistic] = useOptimistic(filters);
  const [text, setText] = useState(filters.text);
  const [seenText, setSeenText] = useState(filters.text);
  // The text this bar last wrote to the URL, normalised the way the parser does.
  const [appliedText, setAppliedText] = useState(filters.text);
  const textId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New URL text (render-time adjustment). Only text from elsewhere (back button, a shared
  // link) replaces the field: the echo of our own debounced update may be older than what
  // the user has typed since, and must not drop those keystrokes.
  if (seenText !== filters.text) {
    setSeenText(filters.text);
    if (filters.text !== appliedText) {
      setAppliedText(filters.text);
      setText(filters.text);
    }
  }

  // Latest values for the debounced text update and for quick successive toggles: `filters`
  // advances as soon as a change is applied, before the new URL has re-rendered the page.
  const latest = useRef({ filters, preserved, pathname });
  useEffect(() => {
    latest.current = { ...latest.current, preserved, pathname };
  });
  useEffect(() => {
    latest.current = { ...latest.current, filters };
  }, [filters]);
  useEffect(() => () => clearTimer(), []);

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function apply(next: IssueFilters) {
    clearTimer();
    latest.current = { ...latest.current, filters: next };
    setAppliedText(next.text);
    // "Clear filters" (or Enter) sets the text from here; typing already shows it.
    if (normalise(text) !== next.text) setText(next.text);
    const { preserved: keep, pathname: path } = latest.current;
    const query = filtersToSearchParams(next, keep).toString();
    startTransition(() => {
      showOptimistic(next);
      router.replace(query ? `${path}?${query}` : path, { scroll: false });
    });
  }

  /** Applies a change to the latest filters (not this render's, which may be stale). */
  function update(change: (current: IssueFilters) => IssueFilters) {
    apply(change(latest.current.filters));
  }

  function onText(value: string) {
    setText(value);
    clearTimer();
    timer.current = setTimeout(
      () => update((current) => ({ ...current, text: normalise(value) })),
      TEXT_DEBOUNCE_MS,
    );
  }

  const assigneeOptions = [
    { value: ASSIGNEE_ME, label: "Me" },
    { value: ASSIGNEE_NONE, label: "Unassigned" },
    ...options.users.map((user) => ({ value: user.id, label: user.name })),
  ];

  return (
    <div
      role="search"
      aria-label="Filter issues"
      aria-busy={pending || undefined}
      className="flex flex-wrap items-center gap-2"
    >
      <div className="relative w-56">
        <label htmlFor={textId} className="sr-only">
          Filter by text
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={textId}
          type="search"
          value={text}
          maxLength={TEXT_FILTER_MAX}
          placeholder="Filter by text"
          className="h-8 pl-8"
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") update((current) => ({ ...current, text: normalise(text) }));
          }}
        />
      </div>
      <MultiFilter
        label="Type"
        options={ISSUE_TYPES.map((value) => ({ value, label: ISSUE_TYPE_LABELS[value] }))}
        selected={shown.types}
        onToggle={(value, on) =>
          update((current) => ({ ...current, types: toggled(current.types, value, on) }))
        }
      />
      <MultiFilter
        label="Status"
        options={options.statuses.map((status) => ({ value: status.id, label: status.name }))}
        selected={shown.statuses}
        onToggle={(value, on) =>
          update((current) => ({ ...current, statuses: toggled(current.statuses, value, on) }))
        }
      />
      <MultiFilter
        label="Priority"
        options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
        selected={shown.priorities}
        onToggle={(value, on) =>
          update((current) => ({ ...current, priorities: toggled(current.priorities, value, on) }))
        }
      />
      <MultiFilter
        label="Assignee"
        options={assigneeOptions}
        selected={shown.assignees}
        onToggle={(value, on) =>
          update((current) => ({ ...current, assignees: toggled(current.assignees, value, on) }))
        }
      />
      <MultiFilter
        label="Component"
        options={options.components.map((component) => ({
          value: component.id,
          label: component.name,
        }))}
        selected={shown.components}
        onToggle={(value, on) =>
          update((current) => ({ ...current, components: toggled(current.components, value, on) }))
        }
      />
      <MultiFilter
        label="Label"
        options={options.labels.map((label) => ({ value: label.id, label: label.name }))}
        selected={shown.labels}
        onToggle={(value, on) =>
          update((current) => ({ ...current, labels: toggled(current.labels, value, on) }))
        }
      />
      {hasActiveFilters(shown) ? (
        <Button variant="ghost" size="sm" onClick={() => apply(EMPTY_FILTERS)}>
          <X aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
      {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

function toggled<T>(values: T[], value: T, on: boolean): T[] {
  const without = values.filter((item) => item !== value);
  return on ? [...without, value] : without;
}

function MultiFilter<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T, on: boolean) => void;
}) {
  const names = options.filter((option) => selected.includes(option.value)).map((o) => o.label);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={selected.length > 0 ? "secondary" : "outline"}
          size="sm"
          aria-label={selected.length > 0 ? `${label}: ${names.join(", ")}` : `${label}: any`}
        >
          {label}
          {selected.length > 0 ? (
            <span className="rounded bg-background px-1 text-xs tabular-nums">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">None yet</p>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={String(option.value)}
              checked={selected.includes(option.value)}
              // Keep the menu open so several values can be picked in a row.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => onToggle(option.value, checked)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
