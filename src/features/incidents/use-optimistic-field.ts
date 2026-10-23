"use client";

import { useState, useTransition } from "react";

import { type ActionResult } from "@/lib/action-result";
import { callAction } from "@/features/issue/client-utils";

/**
 * A field shown optimistically: `save(next)` shows `next` at once, calls the action, and
 * rolls back to the previous value if it fails. A new server value (after the page
 * re-renders) replaces the local one.
 */
export function useOptimisticField<T>(serverValue: T) {
  const [value, setValue] = useState(serverValue);
  const [seen, setSeen] = useState(serverValue);
  const [pending, startTransition] = useTransition();
  if (seen !== serverValue) {
    setSeen(serverValue);
    setValue(serverValue);
  }

  function save(next: T, action: () => Promise<ActionResult<unknown>>, onSaved?: () => void) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await callAction(action);
      if (result === null) setValue(previous);
      else onSaved?.();
    });
  }

  return { value, save, pending };
}
