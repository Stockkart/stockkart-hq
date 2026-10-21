"use client";

import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { shouldIgnoreShortcut } from "@/features/issue/keyboard";

import { matchesShortcut, SHORTCUT_SCOPES, SHORTCUTS } from "./shortcuts";

/**
 * SPEC §9.5 `?`: the shortcut help, built from the shared registry (`shortcuts.ts`). A
 * Radix dialog: focus moves into it, Tab stays inside, Esc (or the close button) closes it
 * and returns focus. Ignored while typing (a `?` in a field is just text).
 */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut(event, "help") || shouldIgnoreShortcut(event)) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The button is the dialog's trigger, so closing returns focus to it (also after `?`).
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="?"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work when you are not typing in a field. Press Esc to close.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {SHORTCUT_SCOPES.map((scope) => (
            <section key={scope} aria-labelledby={`shortcuts-${scope}`}>
              <h3
                id={`shortcuts-${scope}`}
                className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {scope === "Lists" ? "In lists (issues, backlog)" : scope}
              </h3>
              <dl className="divide-y rounded-md border text-sm">
                {SHORTCUTS.filter((shortcut) => shortcut.scope === scope).map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between gap-4 px-3 py-1.5"
                  >
                    <dt>{shortcut.description}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd key={key} className="rounded border bg-muted px-1.5 font-mono text-xs">
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
