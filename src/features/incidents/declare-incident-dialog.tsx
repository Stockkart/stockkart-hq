"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect, Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_TITLE_MAX,
  type IncidentSeverity,
} from "@/lib/incidents/constants";
import { fromLocalInput, toLocalInput } from "@/lib/incidents/datetime";
import { incidentPath } from "@/lib/incidents/rules";
import { INCIDENT_SUMMARY_MAX } from "@/lib/incidents/schemas";
import { type IncidentServiceRef } from "@/lib/incidents/views";
import { type UserOption } from "@/lib/service-registry/views";
import { declareIncidentAction } from "@/server/actions/incidents";

import { SeverityBadge } from "./incident-badges";

const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * INC-1 "Declare incident": title, severity, started (default now), commander (default
 * me), affected services, summary. Opens the new incident on success.
 */
export function DeclareIncidentDialog({
  open,
  onOpenChange,
  projectKey,
  currentUserId,
  users,
  services,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectKey: string;
  currentUserId: string;
  users: UserOption[];
  services: IncidentServiceRef[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("sev2");
  const [startedAt, setStartedAt] = useState(() => toLocalInput(new Date()));
  const [commanderId, setCommanderId] = useState<string | null>(currentUserId);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const base = useId();
  const id = (field: string) => `${base}-${field}`;

  function submit() {
    const started = fromLocalInput(startedAt);
    if (!title.trim()) return setError("Give the incident a title");
    if (!started) return setError("Enter when it started");
    setError(null);
    startTransition(async () => {
      const created = await callAction(() =>
        declareIncidentAction({
          projectKey,
          title,
          severity,
          startedAt: started,
          commanderId,
          serviceIds,
          summary,
        }),
      );
      if (!created) return;
      onOpenChange(false);
      router.push(incidentPath(projectKey, created.number));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Declare incident</DialogTitle>
          <DialogDescription>
            It opens as Investigating. The commander is notified (unless that is you).
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("title")}>Title</Label>
            <Input
              id={id("title")}
              autoFocus
              value={title}
              maxLength={INCIDENT_TITLE_MAX}
              aria-required="true"
              placeholder="Checkout returns 500s"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("severity")}>Severity</Label>
              <Select
                id={id("severity")}
                label="Severity"
                value={severity}
                options={INCIDENT_SEVERITIES.map((value) => ({
                  value,
                  label: INCIDENT_SEVERITY_LABELS[value],
                  icon: <SeverityBadge severity={value} className="px-1 py-0" />,
                }))}
                onChange={(value) => {
                  if (value) setSeverity(value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("started")}>Started</Label>
              <Input
                id={id("started")}
                type="datetime-local"
                value={startedAt}
                max={toLocalInput(new Date())}
                onChange={(event) => setStartedAt(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("commander")}>Commander</Label>
              <Select
                id={id("commander")}
                label="Commander"
                value={commanderId}
                clearLabel="No commander"
                options={users.map((user) => ({
                  value: user.id,
                  label:
                    user.id === currentUserId
                      ? `${user.name || user.email} (me)`
                      : user.name || user.email,
                  keywords: user.email,
                }))}
                onChange={setCommanderId}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("services")}>Affected services</Label>
              <MultiSelect
                id={id("services")}
                label="Affected services"
                placeholder={services.length === 0 ? "No services registered" : "None"}
                value={serviceIds}
                options={services.map((service) => ({ value: service.id, label: service.name }))}
                onChange={setServiceIds}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("summary")}>Summary</Label>
            <textarea
              id={id("summary")}
              rows={3}
              value={summary}
              maxLength={INCIDENT_SUMMARY_MAX}
              placeholder="What is happening, and who is affected? (optional)"
              className={textareaClass}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>
          <p aria-live="assertive" className="text-sm text-destructive">
            {error}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Declare incident
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
