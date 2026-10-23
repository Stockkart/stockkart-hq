import { type IncidentSeverity, type IncidentStatus } from "@/lib/incidents/constants";

import { type ServiceEnvironment, type ServiceLink } from "./constants";

/** Read models of the service registry pages (SVC-1). Plain data only. */

export interface ServiceCard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  runtime: string | null;
  repo: string | null;
  ownerId: string | null;
  ownerName: string | null;
  environments: ServiceEnvironment[];
  links: ServiceLink[];
  position: string;
  /** Incidents that started within `RECENT_INCIDENT_DAYS` and affect this service. */
  recentIncidents: number;
}

export interface ServiceDetail extends ServiceCard {
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** An incident affecting a service (newest first on the service page). */
export interface ServiceIncidentRow {
  id: string;
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: Date;
}

/** A doc or issue linked from the service ("Linked", via `entity_links`). */
export interface ServiceLinkView {
  linkId: string;
  kind: "issue" | "doc";
  /** `STK-12 Title` or the doc title. */
  label: string;
  href: string;
}

export interface UserOption {
  id: string;
  name: string;
  email: string;
}
