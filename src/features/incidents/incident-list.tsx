"use client";

import { Siren, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { MultiSelect, Select } from "@/components/ui/select";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUSES,
} from "@/lib/incidents/constants";
import { formatDateTime } from "@/lib/incidents/datetime";
import { incidentPath, isOpenIncident } from "@/lib/incidents/rules";
import { type IncidentListFilter } from "@/lib/incidents/schemas";
import { type IncidentRow, type IncidentServiceRef } from "@/lib/incidents/views";
import { type UserOption } from "@/lib/service-registry/views";
import { cn } from "@/lib/utils";

import { DeclareIncidentDialog } from "./declare-incident-dialog";
import { IncidentStatusBadge, SeverityBadge } from "./incident-badges";
import { LiveDuration } from "./live-duration";

/**
 * INC-1 list: open incidents pinned on top (the server orders them), then resolved ones;
 * filters by status, severity and service live in the URL (`?status=…&severity=…&service=`),
 * so a filtered list can be shared and Back works.
 */
export function IncidentList({
  projectKey,
  incidents,
  filter,
  services,
  users,
  currentUserId,
}: {
  projectKey: string;
  incidents: IncidentRow[];
  filter: IncidentListFilter;
  services: IncidentServiceRef[];
  users: UserOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [declaring, setDeclaring] = useState(false);
  const open = incidents.filter((row) => isOpenIncident(row.status));
  const closed = incidents.filter((row) => !isOpenIncident(row.status));
  const filtered = filter.status.length + filter.severity.length > 0 || filter.service !== null;

  function apply(next: IncidentListFilter) {
    const params = new URLSearchParams();
    for (const status of next.status) params.append("status", status);
    for (const severity of next.severity) params.append("severity", severity);
    if (next.service) params.set("service", next.service);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <Button size="sm" onClick={() => setDeclaring(true)}>
          <Siren aria-hidden="true" />
          Declare incident
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <MultiSelect
          variant="chip"
          label="Status"
          aria-label="Filter by status"
          placeholder="Status"
          value={filter.status}
          options={INCIDENT_STATUSES.map((value) => ({
            value,
            label: INCIDENT_STATUS_LABELS[value],
          }))}
          onChange={(status) => apply({ ...filter, status })}
        />
        <MultiSelect
          variant="chip"
          label="Severity"
          aria-label="Filter by severity"
          placeholder="Severity"
          value={filter.severity}
          options={INCIDENT_SEVERITIES.map((value) => ({
            value,
            label: INCIDENT_SEVERITY_LABELS[value],
          }))}
          onChange={(severity) => apply({ ...filter, severity })}
        />
        <Select
          variant="chip"
          label="Service"
          aria-label="Filter by service"
          placeholder="Service"
          clearLabel="Any service"
          value={filter.service}
          options={services.map((service) => ({ value: service.slug, label: service.name }))}
          onChange={(service) => apply({ ...filter, service })}
        />
        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => apply({ status: [], severity: [], service: null })}
          >
            <X aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>

      {incidents.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {filtered ? "No incident matches these filters." : "No incidents. Long may it last."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Incidents, open ones first, then newest first</caption>
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Incident
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Severity
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Started
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Duration
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Commander
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Services
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {open.length > 0 && closed.length > 0 ? (
                <GroupRow label={`Open (${open.length})`} />
              ) : null}
              {open.map((row) => (
                <Row key={row.id} row={row} projectKey={projectKey} />
              ))}
              {open.length > 0 && closed.length > 0 ? <GroupRow label="Resolved" /> : null}
              {closed.map((row) => (
                <Row key={row.id} row={row} projectKey={projectKey} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {declaring ? (
        <DeclareIncidentDialog
          open
          onOpenChange={setDeclaring}
          projectKey={projectKey}
          currentUserId={currentUserId}
          users={users}
          services={services}
        />
      ) : null}
    </div>
  );
}

function GroupRow({ label }: { label: string }) {
  return (
    <tr className="bg-muted/20">
      <th
        scope="rowgroup"
        colSpan={7}
        className="px-3 py-1 text-left text-xs font-medium text-muted-foreground"
      >
        {label}
      </th>
    </tr>
  );
}

function Row({ row, projectKey }: { row: IncidentRow; projectKey: string }) {
  const openNow = isOpenIncident(row.status);
  return (
    <tr className={cn(openNow && "bg-red-50/40 dark:bg-red-950/10")}>
      <td className="px-3 py-2">
        <Link href={incidentPath(projectKey, row.number)} className="hover:underline">
          <span className="font-mono text-xs text-muted-foreground">{row.key}</span>{" "}
          <span className="font-medium">{row.title}</span>
        </Link>
      </td>
      <td className="px-3 py-2">
        <SeverityBadge severity={row.severity} />
      </td>
      <td className="px-3 py-2">
        <IncidentStatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        <time dateTime={new Date(row.startedAt).toISOString()} suppressHydrationWarning>
          {formatDateTime(new Date(row.startedAt))}
        </time>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <LiveDuration startedAt={row.startedAt} resolvedAt={row.resolvedAt} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{row.commanderName ?? "—"}</td>
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-1">
          {row.services.map((service) => (
            <Link
              key={service.id}
              href={`/${projectKey}/services/${service.slug}`}
              className="rounded-full bg-secondary px-2 py-0.5 text-xs hover:underline"
            >
              {service.name}
            </Link>
          ))}
        </span>
      </td>
    </tr>
  );
}
