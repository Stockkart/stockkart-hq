"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A text field that saves on Enter or blur and resets on Escape (settings rows). Shows the
 * saved value again when the save is refused. `validate` returns an error message or null.
 */
export function InlineText({
  label,
  value,
  onCommit,
  validate,
  maxLength,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  validate?: (next: string) => string | null;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function commit() {
    if (draft === null) return;
    const next = draft.replace(/\s+/g, " ").trim();
    const problem = validate?.(next) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setDraft(null);
    if (next !== value) onCommit(next);
  }

  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <Input
        aria-label={label}
        value={draft ?? value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        className="h-8"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape" && draft !== null) {
            event.preventDefault();
            setDraft(null);
            setError(null);
          }
        }}
      />
      <span id={errorId} aria-live="polite" className="text-xs text-destructive">
        {error}
      </span>
    </span>
  );
}
