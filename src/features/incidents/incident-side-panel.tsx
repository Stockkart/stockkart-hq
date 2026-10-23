"use client";

import { FilePlus2, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect, Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import { docPath } from "@/lib/docs/views";
import { type IncidentStatus } from "@/lib/incidents/constants";
import { fromLocalInput, toLocalInput } from "@/lib/incidents/datetime";
import { timeOrderError } from "@/lib/incidents/rules";
import { type IncidentDetail, type IncidentServiceRef } from "@/lib/incidents/views";
import { type UserOption } from "@/lib/service-registry/views";
import {
  createPostmortemAction,
  setIncidentServicesAction,
  updateIncidentAction,
  updateIncidentTimesAction,
} from "@/server/actions/incidents";

import { LiveDuration } from "./live-duration";
import { useOptimisticField } from "./use-optimistic-field";

const subscribeNothing = () => () => {};

/**
 * INC-1/2 side panel: commander, affected services, times (editable, validated in order),
 * duration and the postmortem. Field changes are optimistic with rollback.
 */
export function IncidentSidePanel({
  projectKey,
  incident,
  users,
  services,
  currentUserId,
}: {
  projectKey: string;
  incident: IncidentDetail;
  users: UserOption[];
  services: IncidentServiceRef[];
  currentUserId: string;
}) {
  const ids = { commander: useId(), services: useId() };
  // The time inputs show the viewer's local time zone, which the server does not know:
  // render them in the browser only, so server and client HTML never disagree.
  const isClient = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const commander = useOptimisticField(incident.commanderId);
  const serverServiceIds = useMemo(
    () => incident.services.map((service) => service.id),
    [incident.services],
  );
  const affected = useOptimisticField(serverServiceIds);
  // Deleted services stay listed while still attached, so they can be removed.
  const serviceOptions = useMemo(() => {
    const options = services.map((service) => ({ value: service.id, label: service.name }));
    for (const service of incident.services) {
      if (!options.some((option) => option.value === service.id)) {
        options.push({ value: service.id, label: service.name });
      }
    }
    return options;
  }, [services, incident.services]);

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
        <dt>
          <label htmlFor={ids.commander} className="text-muted-foreground">
            Commander
          </label>
        </dt>
        <dd>
          <Select
            id={ids.commander}
            label="Commander"
            value={commander.value}
            clearLabel="No commander"
            options={users.map((user) => ({
              value: user.id,
              label:
                user.id === currentUserId
                  ? `${user.name || user.email} (me)`
                  : user.name || user.email,
              keywords: user.email,
            }))}
            onChange={(next) => {
              if (next === commander.value) return;
              commander.save(next, () =>
                updateIncidentAction({ incidentId: incident.id, commanderId: next }),
              );
            }}
          />
        </dd>
        <dt>
          <label htmlFor={ids.services} className="text-muted-foreground">
            Services
          </label>
        </dt>
        <dd>
          <MultiSelect
            id={ids.services}
            label="Affected services"
            placeholder="None"
            value={affected.value}
            options={serviceOptions}
            onChange={(next) =>
              affected.save(next, () =>
                setIncidentServicesAction({ incidentId: incident.id, serviceIds: next }),
              )
            }
          />
        </dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd>
          <LiveDuration startedAt={incident.startedAt} resolvedAt={incident.resolvedAt} />
        </dd>
      </dl>
      {isClient ? (
        <TimesEditor
          // A fresh form whenever the stored times change (after a status move, for example).
          key={`${String(incident.startedAt)}|${String(incident.mitigatedAt)}|${String(incident.resolvedAt)}|${incident.status}`}
          incidentId={incident.id}
          status={incident.status}
          startedAt={new Date(incident.startedAt)}
          mitigatedAt={incident.mitigatedAt ? new Date(incident.mitigatedAt) : null}
          resolvedAt={incident.resolvedAt ? new Date(incident.resolvedAt) : null}
        />
      ) : null}
      <PostmortemPanel
        projectKey={projectKey}
        incidentId={incident.id}
        postmortem={incident.postmortem}
      />
    </div>
  );
}

function TimesEditor({
  incidentId,
  status,
  startedAt,
  mitigatedAt,
  resolvedAt,
}: {
  incidentId: string;
  status: IncidentStatus;
  startedAt: Date;
  mitigatedAt: Date | null;
  resolvedAt: Date | null;
}) {
  const [started, setStarted] = useState(toLocalInput(startedAt));
  const [mitigated, setMitigated] = useState(mitigatedAt ? toLocalInput(mitigatedAt) : "");
  const [resolved, setResolved] = useState(resolvedAt ? toLocalInput(resolvedAt) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const base = useId();
  const changed =
    started !== toLocalInput(startedAt) ||
    mitigated !== (mitigatedAt ? toLocalInput(mitigatedAt) : "") ||
    resolved !== (resolvedAt ? toLocalInput(resolvedAt) : "");

  function save() {
    // The inputs hold minutes only: an untouched field sends its stored instant, so saving
    // one time never truncates (or logs a change to) the others.
    const keep = (value: string, stored: Date | null) =>
      stored && value === toLocalInput(stored)
        ? stored.toISOString()
        : value
          ? fromLocalInput(value)
          : null;
    const startedIso = keep(started, startedAt);
    if (!startedIso) return setError("Enter when it started");
    const mitigatedIso = keep(mitigated, mitigatedAt);
    const resolvedIso = keep(resolved, resolvedAt);
    const problem = timeOrderError(status, {
      startedAt: new Date(startedIso),
      mitigatedAt: mitigatedIso ? new Date(mitigatedIso) : null,
      resolvedAt: resolvedIso ? new Date(resolvedIso) : null,
    });
    if (problem) return setError(problem);
    setError(null);
    startTransition(async () => {
      const result = await callAction(() =>
        updateIncidentTimesAction({
          incidentId,
          startedAt: startedIso,
          mitigatedAt: mitigatedIso,
          resolvedAt: resolvedIso,
        }),
      );
      if (result !== null) router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-2"
      aria-labelledby={`${base}-heading`}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <h2 id={`${base}-heading`} className="text-sm font-semibold">
        Times
      </h2>
      <TimeField id={`${base}-started`} label="Started" value={started} onChange={setStarted} />
      {mitigatedAt || status !== "investigating" ? (
        <TimeField
          id={`${base}-mitigated`}
          label="Mitigated"
          value={mitigated}
          onChange={setMitigated}
        />
      ) : null}
      {status === "resolved" ? (
        <TimeField
          id={`${base}-resolved`}
          label="Resolved"
          value={resolved}
          onChange={setResolved}
        />
      ) : null}
      <p aria-live="assertive" className="text-xs text-destructive">
        {error}
      </p>
      {changed ? (
        <Button type="submit" size="sm" variant="outline" className="self-start" disabled={pending}>
          Save times
        </Button>
      ) : null}
    </form>
  );
}

function TimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** INC-2 "Create postmortem" / "Open postmortem" (idempotent on the server). */
function PostmortemPanel({
  projectKey,
  incidentId,
  postmortem,
}: {
  projectKey: string;
  incidentId: string;
  postmortem: { id: string; title: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="flex flex-col gap-2" aria-label="Postmortem">
      <h2 className="text-sm font-semibold">Postmortem</h2>
      {postmortem ? (
        <Link
          href={docPath(projectKey, postmortem.id)}
          className="inline-flex items-center gap-1.5 text-sm hover:underline"
        >
          <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{postmortem.title}</span>
        </Link>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await callAction(() => createPostmortemAction({ incidentId }));
              if (!result) return;
              if (!result.created) toast.info("This incident already has a postmortem.");
              router.push(docPath(projectKey, result.docId));
            })
          }
        >
          <FilePlus2 aria-hidden="true" />
          {pending ? "Creating…" : "Create postmortem"}
        </Button>
      )}
    </section>
  );
}
