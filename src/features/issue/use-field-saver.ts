"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FieldValue = string | number | null;

/**
 * Optimistic, ordered saving for a set of independent fields (the issue side panel).
 *
 * - A change shows at once (a local override) and is saved after `delayMs` of quiet, or
 *   right away on blur (`flush`) or when `immediate`. Typing a date digit by digit (or
 *   stepping through values with the arrow keys) therefore results in one save, not one per
 *   step. A pick in one of our pickers is a single deliberate choice and saves `immediate`.
 * - Saves of the same field run one after another, so an older response can never land
 *   after, or undo, a newer one.
 * - On failure the override is dropped and the server value shows again (the caller reports
 *   the error). Once the server value catches up (after the page refresh), or changes because
 *   someone else edited it, the override is dropped and the server value shows.
 */
export function useFieldSaver<F extends string>(
  serverValues: Record<F, FieldValue>,
  save: (field: F, value: FieldValue) => Promise<boolean>,
  delayMs = 600,
) {
  const [overrides, setOverrides] = useState<Partial<Record<F, FieldValue>>>({});
  // Fields with a scheduled or in-flight save; their overrides survive a refresh.
  const [busy, setBusy] = useState<Partial<Record<F, number>>>({});
  // Callers rebuild `serverValues` on every render, so compare by content.
  const serverKey = JSON.stringify(serverValues);
  const [seenServerKey, setSeenServerKey] = useState(serverKey);

  // New server data (render-time adjustment, see react.dev "you might not need an effect"):
  // drop overrides the server has caught up with, or that are not waiting on a save.
  if (seenServerKey !== serverKey) {
    setSeenServerKey(serverKey);
    setOverrides((current) => {
      const next: Partial<Record<F, FieldValue>> = {};
      for (const field of Object.keys(current) as F[]) {
        const value = current[field];
        if (value === undefined || value === serverValues[field]) continue;
        if (busy[field]) next[field] = value;
      }
      return next;
    });
  }

  const timers = useRef(new Map<F, ReturnType<typeof setTimeout>>());
  const chains = useRef(new Map<F, Promise<void>>());
  const latest = useRef(overrides);
  const saveRef = useRef(save);
  useEffect(() => {
    latest.current = overrides;
    saveRef.current = save;
  });

  const changeBusy = useCallback((field: F, delta: number) => {
    setBusy((current) => ({ ...current, [field]: (current[field] ?? 0) + delta }));
  }, []);

  const persist = useCallback(
    (field: F, value: FieldValue) => {
      changeBusy(field, 1);
      const run = async () => {
        const ok = await saveRef.current(field, value);
        if (!ok) {
          // Show the server value again, unless the user has already picked something newer.
          setOverrides((current) => {
            if (current[field] !== value) return current;
            const next = { ...current };
            delete next[field];
            return next;
          });
        }
        changeBusy(field, -1);
      };
      const next = (chains.current.get(field) ?? Promise.resolve()).then(run);
      chains.current.set(field, next);
    },
    [changeBusy],
  );

  const flush = useCallback(
    (field: F) => {
      const timer = timers.current.get(field);
      if (timer === undefined) return;
      clearTimeout(timer);
      timers.current.delete(field);
      changeBusy(field, -1);
      const value = latest.current[field];
      if (value !== undefined) persist(field, value);
    },
    [changeBusy, persist],
  );

  const change = useCallback(
    (field: F, value: FieldValue, options: { immediate?: boolean } = {}) => {
      setOverrides((current) => ({ ...current, [field]: value }));
      latest.current = { ...latest.current, [field]: value };
      const pending = timers.current.get(field);
      if (pending !== undefined) {
        clearTimeout(pending);
        timers.current.delete(field);
        changeBusy(field, -1);
      }
      if (options.immediate) {
        persist(field, value);
        return;
      }
      changeBusy(field, 1);
      timers.current.set(
        field,
        setTimeout(() => flush(field), delayMs),
      );
    },
    [changeBusy, delayMs, flush, persist],
  );

  // Leaving the page saves what is still waiting.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const [field, timer] of pending) {
        clearTimeout(timer);
        const value = latest.current[field];
        if (value !== undefined) void saveRef.current(field, value);
      }
      pending.clear();
    };
  }, []);

  const valueOf = (field: F): FieldValue => {
    const override = overrides[field];
    return override === undefined ? serverValues[field] : override;
  };

  return { valueOf, change, flush };
}
