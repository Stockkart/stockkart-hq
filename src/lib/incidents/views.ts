import { type StatusCategory } from "@/lib/issues/constants";

import { type IncidentSeverity, type IncidentStatus, type IncidentTimelineKind } from "./constants";

/** Read models of the incident pages (INC-1/2). Plain data only. */

export interface IncidentServiceRef {
  id: string;
  slug: string;
  name: string;
}

export interface IncidentRow {
  id: string;
  number: number;
  key: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: Date;
  mitigatedAt: Date | null;
  resolvedAt: Date | null;
  commanderId: string | null;
  commanderName: string | null;
  services: IncidentServiceRef[];
}

export interface IncidentDetail extends IncidentRow {
  summary: string;
  /** Null when there is none or it was deleted (a soft-deleted doc counts as missing). */
  postmortem: { id: string; title: string } | null;
  createdAt: Date;
}

export interface TimelineEntryView {
  id: string;
  at: Date;
  kind: IncidentTimelineKind;
  body: string;
  authorId: string | null;
  authorName: string | null;
}

export interface FollowUpView {
  linkId: string;
  issueId: string;
  key: string;
  title: string;
  status: { name: string; category: StatusCategory };
}

export interface IncidentActivityView {
  id: string;
  actorName: string | null;
  action: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

/** "From incident INC-n" on an issue's Links panel. */
export interface IncidentRefView {
  id: string;
  key: string;
  title: string;
  href: string;
}
