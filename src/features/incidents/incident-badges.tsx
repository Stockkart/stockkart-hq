import { CircleCheck, CircleDot, ShieldCheck } from "lucide-react";

import {
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/constants";
import { cn } from "@/lib/utils";

/**
 * INC-1 badges. Colour is never the only signal: every badge carries its text (SEV1, SEV2,
 * SEV3; Investigating …). No "use client": usable on the server too.
 */

const SEVERITY_STYLES: Record<IncidentSeverity, string> = {
  sev1: "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  sev2: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  sev3: "border-border bg-muted text-muted-foreground",
};

export function SeverityBadge({
  severity,
  className,
}: {
  severity: IncidentSeverity;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs font-semibold",
        SEVERITY_STYLES[severity],
        className,
      )}
    >
      {INCIDENT_SEVERITY_LABELS[severity]}
    </span>
  );
}

const STATUS_STYLES: Record<IncidentStatus, { icon: typeof CircleDot; className: string }> = {
  investigating: { icon: CircleDot, className: "text-red-600 dark:text-red-400" },
  mitigated: { icon: ShieldCheck, className: "text-amber-600 dark:text-amber-400" },
  resolved: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-400" },
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const { icon: Icon, className } = STATUS_STYLES[status];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      <Icon aria-hidden="true" className={cn("size-3.5", className)} />
      {INCIDENT_STATUS_LABELS[status]}
    </span>
  );
}
