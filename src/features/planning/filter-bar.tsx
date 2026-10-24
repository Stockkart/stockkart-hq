"use client";

import { ChevronDown, Eye, Save, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect, type OptionValue, type SelectOption } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import {
  labelOptions,
  priorityOptions,
  releaseOptions,
  statusOptions,
  typeOptions,
  userOptions,
} from "@/features/issue/field-options";
import { ISSUE_TYPES } from "@/lib/issues/constants";
import {
  ASSIGNEE_ME,
  ASSIGNEE_NONE,
  EMPTY_FILTERS,
  hasActiveFilters,
  type IssueFilters,
  RELEASE_NONE,
  TEXT_FILTER_MAX,
} from "@/lib/issues/filters";
import { type LabelView, type NamedOption, type StatusOption } from "@/lib/issues/views";
import { type ReleaseOption } from "@/lib/releases/views";
import {
  type ListDefaultsContext,
  listDefaultFilters,
  listFiltersQuery,
  listViewOf,
  sameView,
  viewDefaultsOf,
} from "@/lib/views/view-defaults";
import { saveViewDefaultsAction } from "@/server/actions/settings";

/** Options for the pickers; usually `ProjectMeta`. */
export interface FilterOptions {
  statuses: StatusOption[];
  components: NamedOption[];
  labels: LabelView[];
  users: NamedOption[];
  /** REL-1: shows the "Fix version" filter (`release=` in the URL) when given. */
  releases?: ReleaseOption[];
}

interface FilterBarProps {
  filters: IssueFilters;
  options: FilterOptions;
  /** Non-filter params to keep in the URL (sort, group …). */
  preserved?: Record<string, string | undefined>;
  /** Shown next to the filters, e.g. the backlog's "Group by". */
  children?: React.ReactNode;
  /**
   * VW-4 (issue list only): the project's list defaults. "Clear filters" returns to them,
   * "Show all" drops them (`type=all`), and "Save as default" stores the current types and
   * statuses as them (needs `projectKey`).
   */
  listDefaults?: ListDefaultsContext;
  projectKey?: string;
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
export function FilterBar({
  filters,
  options,
  preserved = {},
  children,
  listDefaults,
  projectKey,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();
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
    const query = listFiltersQuery(next, listDefaults ?? null, keep).toString();
    startTransition(() => {
      showOptimistic(next);
      router.replace(query ? `${path}?${query}` : path, { scroll: false });
    });
  }

  /** Applies a change to the latest filters (not this render's, which may be stale). */
  function update(change: (current: IssueFilters) => IssueFilters) {
    apply(change(latest.current.filters));
  }

  /** VW-4: stores the shown types and statuses as the list defaults. */
  function saveListDefault(key: string, defaults: ListDefaultsContext) {
    const current = latest.current.filters;
    const view = listViewOf(current, defaults.statusIds);
    startSaving(async () => {
      const ok =
        (await callAction(() =>
          saveViewDefaultsAction({ projectKey: key, list: viewDefaultsOf(view) }),
        )) !== null;
      if (!ok) return;
      toast.success("Saved as the issue list's default filters");
      if (!defaults.canonical) return;
      // They are the defaults now, so the plain URL (plus the other filters) shows them.
      const saved = {
        ...defaults,
        ...listDefaultFilters(viewDefaultsOf(view), defaults.statusIds),
      };
      const { preserved: keep, pathname: path } = latest.current;
      const query = listFiltersQuery(current, saved, keep).toString();
      router.replace(query ? `${path}?${query}` : path, { scroll: false });
    });
  }

  function onText(value: string) {
    setText(value);
    clearTimer();
    timer.current = setTimeout(
      () => update((current) => ({ ...current, text: normalise(value) })),
      TEXT_DEBOUNCE_MS,
    );
  }

  const assigneeOptions: SelectOption<string>[] = [
    { value: ASSIGNEE_ME, label: "Me" },
    { value: ASSIGNEE_NONE, label: "Unassigned" },
    ...userOptions(options.users),
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
        options={typeOptions(ISSUE_TYPES)}
        selected={shown.types}
        onToggle={(value, on) =>
          update((current) => ({ ...current, types: toggled(current.types, value, on) }))
        }
      />
      <MultiFilter
        label="Status"
        options={statusOptions(options.statuses)}
        selected={shown.statuses}
        onToggle={(value, on) =>
          update((current) => ({ ...current, statuses: toggled(current.statuses, value, on) }))
        }
      />
      <MultiFilter
        label="Priority"
        options={priorityOptions()}
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
        options={labelOptions(options.labels)}
        selected={shown.labels}
        onToggle={(value, on) =>
          update((current) => ({ ...current, labels: toggled(current.labels, value, on) }))
        }
      />
      {options.releases ? (
        <MultiFilter
          label="Fix version"
          options={[
            { value: RELEASE_NONE, label: "No fix version" },
            ...releaseOptions(options.releases),
          ]}
          selected={shown.releases}
          onToggle={(value, on) =>
            update((current) => ({ ...current, releases: toggled(current.releases, value, on) }))
          }
        />
      ) : null}
      {listDefaults ? (
        <ListDefaultButtons
          shown={shown}
          defaults={listDefaults}
          saving={saving}
          onClear={() =>
            apply({ ...EMPTY_FILTERS, types: listDefaults.types, statuses: listDefaults.statuses })
          }
          onShowAll={() => apply({ ...latest.current.filters, types: [], statuses: [] })}
          onSave={projectKey ? () => saveListDefault(projectKey, listDefaults) : undefined}
        />
      ) : hasActiveFilters(shown) ? (
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

/** The filters as a comparable string (value order within a dimension ignored). */
function filterKey(filters: IssueFilters): string {
  return JSON.stringify(
    Object.entries(filters).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map(String).sort() : value,
    ]),
  );
}

/**
 * VW-4 buttons of the issue list: "Clear filters" back to the project defaults (shown when
 * the filters differ from them), "Show all" without the default types and statuses (when
 * some apply), and "Save as default" for the current types and statuses (when they differ
 * from the defaults).
 */
function ListDefaultButtons({
  shown,
  defaults,
  saving,
  onClear,
  onShowAll,
  onSave,
}: {
  shown: IssueFilters;
  defaults: ListDefaultsContext;
  saving: boolean;
  onClear: () => void;
  onShowAll: () => void;
  onSave?: () => void;
}) {
  const baseline = { ...EMPTY_FILTERS, types: defaults.types, statuses: defaults.statuses };
  const hasDefaults = defaults.types.length > 0 || defaults.statuses.length > 0;
  const narrowed = shown.types.length > 0 || shown.statuses.length > 0;
  const differs = !sameView(
    listViewOf(shown, defaults.statusIds),
    listViewOf(defaults, defaults.statusIds),
  );
  return (
    <>
      {filterKey(shown) !== filterKey(baseline) ? (
        <Button
          variant="ghost"
          size="sm"
          title={hasDefaults ? "Back to the project's default filters" : undefined}
          onClick={onClear}
        >
          <X aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
      {hasDefaults && narrowed ? (
        <Button variant="ghost" size="sm" onClick={onShowAll}>
          <Eye aria-hidden="true" />
          Show all
        </Button>
      ) : null}
      {onSave && differs ? (
        <Button variant="outline" size="sm" disabled={saving} onClick={onSave}>
          <Save aria-hidden="true" />
          Save as default
        </Button>
      ) : null}
    </>
  );
}

/** One filter dimension: any of the picked values (OR), as a compact multi-select. */
function MultiFilter<T extends OptionValue>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: SelectOption<T>[];
  selected: T[];
  onToggle: (value: T, on: boolean) => void;
}) {
  const names = options.filter((option) => selected.includes(option.value)).map((o) => o.label);
  return (
    <MultiSelect
      variant="chip"
      label={label}
      aria-label={selected.length > 0 ? `${label}: ${names.join(", ")}` : `${label}: any`}
      className={selected.length > 0 ? "border-transparent bg-secondary" : undefined}
      value={selected}
      options={options}
      onChange={(_next, change) => onToggle(change.value, change.selected)}
    >
      {() => (
        <>
          {label}
          {selected.length > 0 ? (
            <span className="rounded bg-background px-1 text-xs tabular-nums">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown aria-hidden="true" />
        </>
      )}
    </MultiSelect>
  );
}
