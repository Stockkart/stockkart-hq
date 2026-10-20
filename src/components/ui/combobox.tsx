"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { type ListboxTriggerProps, type ListItem, ListboxPopover } from "./listbox-popover";
import { type OptionValue, type SelectOption } from "./select";

/**
 * Searchable picker over options that are looked up as you type (issues, ADRs, docs).
 * `loadOptions` runs when the popup opens (empty query) and again `debounceMs` after the
 * last keystroke; a newer query aborts the older request and stale answers are dropped,
 * so the list always matches the text. Keyboard and ARIA as in `listbox-popover.tsx`.
 */

export const COMBOBOX_DEBOUNCE_MS = 250;

export interface ComboboxProps<V extends OptionValue> extends ListboxTriggerProps {
  value: V | null;
  /** The current value's label, shown in the trigger (results may not include it). */
  valueLabel?: string | null;
  onChange: (value: V | null, option: SelectOption<V> | null) => void;
  /** Options for `query`; honour `signal` to stop superseded requests. */
  loadOptions: (query: string, signal: AbortSignal) => Promise<SelectOption<V>[]>;
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Nullable fields: a first option with this label sets the value to null. */
  clearLabel?: string;
  debounceMs?: number;
  /** Shown when the query has no results. */
  emptyText?: string;
  align?: "start" | "center" | "end";
}

type LoadState<V extends OptionValue> =
  | { status: "idle" | "loading"; options: SelectOption<V>[] }
  | { status: "done"; options: SelectOption<V>[] }
  | { status: "error"; options: SelectOption<V>[] };

export function Combobox<V extends OptionValue>({
  value,
  valueLabel = null,
  onChange,
  loadOptions,
  label,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  clearLabel,
  debounceMs = COMBOBOX_DEBOUNCE_MS,
  emptyText = "No matches",
  align,
  className,
  ...trigger
}: ComboboxProps<V>) {
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<LoadState<V>>({ status: "idle", options: [] });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = React.useRef<{ seq: number; controller: AbortController | null }>({
    seq: 0,
    controller: null,
  });
  const loader = React.useRef(loadOptions);
  React.useEffect(() => {
    loader.current = loadOptions;
  });

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    request.current.controller?.abort();
    request.current.controller = null;
  }, []);
  React.useEffect(() => cancel, [cancel]);

  function load(text: string) {
    cancel();
    const seq = request.current.seq + 1;
    const controller = new AbortController();
    request.current = { seq, controller };
    setState((current) => ({ status: "loading", options: current.options }));
    loader.current(text, controller.signal).then(
      (options) => {
        if (request.current.seq !== seq) return;
        setState({ status: "done", options });
      },
      () => {
        if (request.current.seq !== seq || controller.signal.aborted) return;
        setState((current) => ({ status: "error", options: current.options }));
      },
    );
  }

  function search(text: string) {
    setQuery(text);
    // Supersede whatever is waiting or in flight; its answer would be for older text.
    cancel();
    request.current.seq += 1;
    // Shown at once; the request waits for a pause in typing.
    setState((current) => ({ status: "loading", options: current.options }));
    timer.current = setTimeout(() => load(text), debounceMs);
  }

  const clear = clearLabel !== undefined && !query.trim();
  const entries: { option: SelectOption<V> | null; item: ListItem }[] = [
    ...(clear
      ? [{ option: null, item: { key: "none", label: clearLabel, selected: value === null } }]
      : []),
    ...state.options.map((option) => ({
      option,
      item: {
        key: `${typeof option.value}:${option.value}`,
        label: option.label,
        keywords: option.keywords,
        icon: option.icon,
        detail: option.detail,
        disabled: option.disabled,
        selected: option.value === value,
      },
    })),
  ];
  const status =
    state.status === "loading"
      ? "Searching…"
      : state.status === "error"
        ? "Could not search. Try again."
        : state.status === "done" && state.options.length === 0
          ? emptyText
          : null;
  const shownLabel =
    value === null
      ? (clearLabel ?? null)
      : (valueLabel ?? state.options.find((o) => o.value === value)?.label ?? null);

  return (
    <ListboxPopover
      {...trigger}
      className={className}
      label={label}
      align={align}
      searchable
      query={query}
      onQueryChange={(text) => {
        // Closing clears the query; that needs no request.
        if (text === "" && query === "") return;
        search(text);
      }}
      searchPlaceholder={searchPlaceholder}
      items={entries.map((entry) => entry.item)}
      onPick={(index) => {
        const entry = entries[index];
        if (entry) onChange(entry.option?.value ?? null, entry.option);
      }}
      onOpenChange={(open) => {
        if (open) load("");
        else {
          cancel();
          setQuery("");
        }
      }}
      status={status}
    >
      <span className={cn("min-w-0 truncate", shownLabel === null && "text-muted-foreground")}>
        {shownLabel ?? placeholder}
      </span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    </ListboxPopover>
  );
}
