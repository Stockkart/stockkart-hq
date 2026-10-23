"use client";

import { Pencil } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { INCIDENT_SUMMARY_MAX } from "@/lib/incidents/schemas";
import { updateIncidentAction } from "@/server/actions/incidents";

import { useOptimisticField } from "./use-optimistic-field";

/** INC-1 plain-text summary (feeds search), edited in place. */
export function IncidentSummary({ incidentId, summary }: { incidentId: string; summary: string }) {
  const field = useOptimisticField(summary);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);
  const ids = { heading: useId(), input: useId() };

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id={ids.heading} className="text-sm font-semibold">
          Summary
        </h2>
        {!editing ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(field.value);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
            Edit<span className="sr-only"> summary</span>
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setEditing(false);
            const next = draft.trim();
            if (next !== field.value) {
              field.save(next, () => updateIncidentAction({ incidentId, summary: next }));
            }
          }}
        >
          <label htmlFor={ids.input} className="sr-only">
            Summary
          </label>
          <textarea
            id={ids.input}
            autoFocus
            rows={4}
            value={draft}
            maxLength={INCIDENT_SUMMARY_MAX}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : field.value ? (
        <p className="text-sm whitespace-pre-wrap">{field.value}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No summary yet.</p>
      )}
    </section>
  );
}
