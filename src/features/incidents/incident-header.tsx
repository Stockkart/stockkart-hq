"use client";

import { Check, Pencil, RotateCcw, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TITLE_MAX,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/constants";
import { fromLocalInput, toLocalInput } from "@/lib/incidents/datetime";
import { INCIDENT_TRANSITIONS, incidentsPath } from "@/lib/incidents/rules";
import { setIncidentStatusAction, updateIncidentAction } from "@/server/actions/incidents";

import { IncidentStatusBadge, SeverityBadge } from "./incident-badges";
import { useOptimisticField } from "./use-optimistic-field";

const TRANSITION_LABELS: Record<IncidentStatus, string> = {
  investigating: "Reopen",
  mitigated: "Mark mitigated",
  resolved: "Resolve",
};

/**
 * INC-1 header: key, title (editable), severity and the status control. A move to
 * Mitigated or Resolved asks when it happened (default now); Reopen is immediate. Every
 * change shows at once and rolls back if the server refuses.
 */
export function IncidentHeader({
  projectKey,
  incident,
}: {
  projectKey: string;
  incident: {
    id: string;
    key: string;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
  };
}) {
  const title = useOptimisticField(incident.title);
  const severity = useOptimisticField(incident.severity);
  const status = useOptimisticField(incident.status);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(incident.title);
  const [pendingMove, setPendingMove] = useState<IncidentStatus | null>(null);
  const [at, setAt] = useState("");
  const ids = { title: useId(), severity: useId(), at: useId() };

  function move(to: IncidentStatus, when?: string) {
    const from = status.value;
    setPendingMove(null);
    status.save(to, () =>
      setIncidentStatusAction({ incidentId: incident.id, from, to, ...(when ? { at: when } : {}) }),
    );
  }

  return (
    <header className="flex flex-col gap-3">
      <Link
        href={incidentsPath(projectKey)}
        className="text-sm text-muted-foreground hover:underline"
      >
        Incidents
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground">{incident.key}</span>
        {editingTitle ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = draftTitle.replace(/\s+/g, " ").trim();
              setEditingTitle(false);
              if (next && next !== title.value) {
                title.save(next, () =>
                  updateIncidentAction({ incidentId: incident.id, title: next }),
                );
              }
            }}
          >
            <label htmlFor={ids.title} className="sr-only">
              Title
            </label>
            <Input
              id={ids.title}
              autoFocus
              value={draftTitle}
              maxLength={INCIDENT_TITLE_MAX}
              className="text-lg font-semibold"
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditingTitle(false);
              }}
            />
            <Button type="submit" size="icon" variant="ghost" aria-label="Save title">
              <Check aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => setEditingTitle(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </form>
        ) : (
          <>
            <h1 className="min-w-0 text-2xl font-semibold break-words">{title.value}</h1>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Edit title"
              onClick={() => {
                setDraftTitle(title.value);
                setEditingTitle(true);
              }}
            >
              <Pencil aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={ids.severity} className="text-sm text-muted-foreground">
            Severity
          </label>
          <Select
            id={ids.severity}
            label="Severity"
            variant="chip"
            value={severity.value}
            options={INCIDENT_SEVERITIES.map((value) => ({
              value,
              label: INCIDENT_SEVERITY_LABELS[value],
              icon: <SeverityBadge severity={value} className="px-1 py-0" />,
            }))}
            onChange={(next) => {
              if (next && next !== severity.value) {
                severity.save(next, () =>
                  updateIncidentAction({ incidentId: incident.id, severity: next }),
                );
              }
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <span className="text-sm text-muted-foreground">Status</span>
          <IncidentStatusBadge status={status.value} />
          {INCIDENT_TRANSITIONS[status.value].map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === "resolved" ? "default" : "outline"}
              disabled={status.pending}
              onClick={() => {
                if (to === "investigating") return move(to);
                setAt(toLocalInput(new Date()));
                setPendingMove(to);
              }}
            >
              {to === "investigating" ? (
                <RotateCcw aria-hidden="true" />
              ) : to === "mitigated" ? (
                <ShieldCheck aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {TRANSITION_LABELS[to]}
            </Button>
          ))}
        </div>
      </div>
      {pendingMove ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const when = fromLocalInput(at);
            if (when) move(pendingMove, when);
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.at} className="text-xs text-muted-foreground">
              {INCIDENT_STATUS_LABELS[pendingMove]} at
            </label>
            <Input
              id={ids.at}
              type="datetime-local"
              autoFocus
              value={at}
              max={toLocalInput(new Date())}
              onChange={(event) => setAt(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={!fromLocalInput(at)}>
            {TRANSITION_LABELS[pendingMove]}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPendingMove(null)}>
            Cancel
          </Button>
        </form>
      ) : null}
    </header>
  );
}
