"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { issueScheduleSchema } from "@/lib/issues/schemas";

export interface Schedule {
  startDate: string | null;
  dueDate: string | null;
}

/**
 * RDM-1 date editor for one epic (the keyboard's Enter on a bar, a click on it, or "Set
 * dates" in the Unscheduled list). Empty fields clear a date; an epic without both dates
 * moves to the Unscheduled list. Checked with the server's own schema before saving.
 */
export function DateDialog({
  epicKey,
  title,
  schedule,
  onSave,
  onClose,
}: {
  epicKey: string;
  title: string;
  schedule: Schedule;
  onSave: (next: Schedule) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(schedule.startDate ?? "");
  const [due, setDue] = useState(schedule.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const ids = { start: useId(), due: useId(), error: useId() };

  function save(next: Schedule) {
    const parsed = issueScheduleSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the dates");
      return;
    }
    onSave(next);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Dates of {epicKey}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save({ startDate: start || null, dueDate: due || null });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.start}>Start date</Label>
            <Input
              id={ids.start}
              type="date"
              value={start}
              aria-describedby={ids.error}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.due}>Due date</Label>
            <Input
              id={ids.due}
              type="date"
              value={due}
              min={start || undefined}
              aria-describedby={ids.error}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setDue(event.target.value)}
            />
          </div>
          <p
            id={ids.error}
            role="alert"
            aria-live="assertive"
            className="min-h-5 text-sm text-destructive"
          >
            {error}
          </p>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={!schedule.startDate && !schedule.dueDate}
              onClick={() => save({ startDate: null, dueDate: null })}
            >
              Clear dates
            </Button>
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit">Save</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
