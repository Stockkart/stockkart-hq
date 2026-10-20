"use client";

import { ChevronDown, Plus } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { type ListboxTriggerProps, type ListItem, ListboxPopover } from "./listbox-popover";

/**
 * Our own pickers (the app uses no native select element; see `listbox-popover.tsx` for keyboard and
 * ARIA). Option data comes with the page, so they open instantly with no network.
 *
 * - `Select`: one value; a search field appears for long lists (more than
 *   `SEARCH_THRESHOLD` options); `clearLabel` adds a first option that sets null.
 * - `MultiSelect`: several values with checkmarks, staying open while picking; with
 *   `onCreate` the search text can become a new option ("Create “…”").
 */

export type OptionValue = string | number;

export interface SelectOption<V extends OptionValue> {
  value: V;
  label: string;
  /** Extra text that search and type-ahead match (an email, an issue key …). */
  keywords?: string;
  /** Shown before the label: an icon, avatar or colour dot (decorative). */
  icon?: React.ReactNode;
  /** Muted text after the label. */
  detail?: string;
  disabled?: boolean;
}

/** More options than this get a search field. */
export const SEARCH_THRESHOLD = 8;

/** Case-insensitive match on the label and keywords. */
export function matchesQuery(option: { label: string; keywords?: string }, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle);
}

const itemKey = (value: OptionValue | null) =>
  value === null ? "none" : `${typeof value}:${value}`;

function TriggerValue({
  option,
  placeholder,
}: {
  option: { label: string; icon?: React.ReactNode } | null;
  placeholder: string;
}) {
  return (
    <>
      <span className={cn("flex min-w-0 items-center gap-2", !option && "text-muted-foreground")}>
        {option?.icon ? (
          <span aria-hidden="true" className="flex shrink-0 items-center">
            {option.icon}
          </span>
        ) : null}
        <span className="truncate">{option ? option.label : placeholder}</span>
      </span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}

export interface SelectProps<V extends OptionValue> extends ListboxTriggerProps {
  value: V | null;
  /** Called with the picked value (null only from the `clearLabel` option). */
  onChange: (value: V | null) => void;
  options: SelectOption<V>[];
  /** Names the listbox; also the trigger's name when it has no `id`/`aria-label`. */
  label: string;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Nullable fields: a first option with this label sets the value to null. */
  clearLabel?: string;
  /** Default: on for more than `SEARCH_THRESHOLD` options. */
  searchable?: boolean;
  align?: "start" | "center" | "end";
}

export function Select<V extends OptionValue>({
  value,
  onChange,
  options,
  label,
  placeholder = "Select…",
  clearLabel,
  searchable = options.length > SEARCH_THRESHOLD,
  align,
  ...trigger
}: SelectProps<V>) {
  const [query, setQuery] = React.useState("");
  const shown = options.filter((option) => matchesQuery(option, query));
  // The clear option is a choice like any other, but not a search result.
  const clear = clearLabel !== undefined && !query.trim();
  const entries: { value: V | null; item: ListItem }[] = [
    ...(clear
      ? [
          {
            value: null,
            item: { key: itemKey(null), label: clearLabel, selected: value === null },
          },
        ]
      : []),
    ...shown.map((option) => ({
      value: option.value,
      item: {
        key: itemKey(option.value),
        label: option.label,
        keywords: option.keywords,
        icon: option.icon,
        detail: option.detail,
        disabled: option.disabled,
        selected: option.value === value,
      },
    })),
  ];
  const current = options.find((option) => option.value === value) ?? null;
  const triggerOption = current ?? (value === null && clearLabel ? { label: clearLabel } : null);

  return (
    <ListboxPopover
      {...trigger}
      label={label}
      align={align}
      items={entries.map((entry) => entry.item)}
      onPick={(index) => {
        const entry = entries[index];
        if (entry) onChange(entry.value);
      }}
      searchable={searchable}
      query={query}
      onQueryChange={setQuery}
      status={entries.length === 0 ? (options.length === 0 ? "No options" : "No matches") : null}
    >
      <TriggerValue option={triggerOption} placeholder={placeholder} />
    </ListboxPopover>
  );
}

export interface MultiSelectProps<V extends OptionValue> extends ListboxTriggerProps {
  value: V[];
  /** The new selection, and the one value that changed. */
  onChange: (next: V[], change: { value: V; selected: boolean }) => void;
  options: SelectOption<V>[];
  label: string;
  placeholder?: string;
  /** Type-to-create: offered when the search text matches no option exactly. */
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  /** Max length of a created value. */
  createMaxLength?: number;
  /** Default: on for long lists, and always with `onCreate`. */
  searchable?: boolean;
  align?: "start" | "center" | "end";
  /** Trigger content; default: the selected labels, or the placeholder. */
  children?: (selected: SelectOption<V>[]) => React.ReactNode;
}

export function MultiSelect<V extends OptionValue>({
  value,
  onChange,
  options,
  label,
  placeholder = "Select…",
  onCreate,
  createLabel = (text) => `Create “${text}”`,
  createMaxLength,
  searchable = options.length > SEARCH_THRESHOLD || onCreate !== undefined,
  align,
  children,
  ...trigger
}: MultiSelectProps<V>) {
  const [query, setQuery] = React.useState("");
  const text = query.replace(/\s+/g, " ").trim();
  const shown = options.filter((option) => matchesQuery(option, query));
  const canCreate =
    onCreate !== undefined &&
    text !== "" &&
    (createMaxLength === undefined || text.length <= createMaxLength) &&
    !options.some((option) => option.label.toLowerCase() === text.toLowerCase());
  const selected = options.filter((option) => value.includes(option.value));

  type Entry = { kind: "option"; option: SelectOption<V> } | { kind: "create" };
  const entries: Entry[] = [
    ...shown.map((option): Entry => ({ kind: "option", option })),
    ...(canCreate ? [{ kind: "create" } as const] : []),
  ];
  const items: ListItem[] = entries.map((entry) =>
    entry.kind === "create"
      ? {
          key: "create",
          label: createLabel(text),
          icon: <Plus className="size-4" />,
          selected: false,
        }
      : {
          key: itemKey(entry.option.value),
          label: entry.option.label,
          keywords: entry.option.keywords,
          icon: entry.option.icon,
          detail: entry.option.detail,
          disabled: entry.option.disabled,
          selected: value.includes(entry.option.value),
        },
  );

  return (
    <ListboxPopover
      {...trigger}
      label={label}
      align={align}
      multiple
      items={items}
      onPick={(index) => {
        const entry = entries[index];
        if (!entry) return;
        if (entry.kind === "create") {
          onCreate?.(text);
          setQuery("");
          return;
        }
        const on = !value.includes(entry.option.value);
        const next = on
          ? [...value, entry.option.value]
          : value.filter((item) => item !== entry.option.value);
        onChange(next, { value: entry.option.value, selected: on });
      }}
      searchable={searchable}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={onCreate ? "Search or create…" : "Search…"}
      status={
        items.length === 0
          ? options.length === 0 && !onCreate
            ? "None yet"
            : onCreate
              ? "Type to create one"
              : "No matches"
          : null
      }
    >
      {children ? (
        children(selected)
      ) : (
        <TriggerValue
          option={
            selected.length > 0
              ? { label: selected.map((option) => option.label).join(", ") }
              : null
          }
          placeholder={placeholder}
        />
      )}
    </ListboxPopover>
  );
}
