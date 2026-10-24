"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { type CostCurrency } from "@/lib/costs/constants";
import { currencySymbol, minorToInput, parseMoney } from "@/lib/costs/money";
import { cn } from "@/lib/utils";

/**
 * A money field (COST-3): the currency symbol, then text parsed with `parseMoney` into
 * integer minor units. It commits on blur or Enter (`onCommit(minor)`, or `null` when
 * cleared); Esc puts the saved value back. A typing error stays on the field
 * (`aria-invalid` + a message announced politely) and nothing is sent.
 */
export function MoneyInput({
  value,
  currency,
  onCommit,
  label,
  labelHidden = false,
  disabled,
  placeholder = "0",
  className,
  allowEmpty = true,
}: {
  value: number | null;
  currency: CostCurrency;
  onCommit: (minor: number | null) => void;
  label: string;
  /** The label is for assistive technology only (e.g. inside a table row). */
  labelHidden?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Whether clearing the field commits `null`. */
  allowEmpty?: boolean;
}) {
  const saved = value === null ? "" : minorToInput(value);
  const [text, setText] = useState(saved);
  const [shown, setShown] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  if (shown !== saved) {
    // A newer saved value arrived (server refresh or rollback): show it.
    setShown(saved);
    setText(saved);
    setError(null);
  }

  function commit() {
    if (text.trim() === "") {
      if (!allowEmpty) {
        setError("Enter an amount");
        return;
      }
      setError(null);
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = parseMoney(text, currency);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setText(minorToInput(parsed.value));
    if (parsed.value !== value) onCommit(parsed.value);
  }

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium", labelHidden && "sr-only")}>
        {label}
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground"
        >
          {currencySymbol(currency)}
        </span>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-8 pl-6 text-right tabular-nums"
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              setText(saved);
              setError(null);
            }
          }}
        />
      </div>
      <span id={`${id}-error`} aria-live="polite" className="text-xs text-destructive">
        {error}
      </span>
    </div>
  );
}
