import { rt, type RichTextDoc, type RichTextNode } from "@/lib/rich-text";

import {
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentTimelineKind,
} from "./constants";
import { formatDuration, incidentDurationMs } from "./rules";

/**
 * INC-2 "Create postmortem": the built-in postmortem template (DOC-5) with its Summary,
 * Impact, Timeline and Action items sections filled from the incident. Pure: the service
 * reads the data and the template, this builds the doc JSON.
 *
 * Follow-up issues go in as plain `STK-12 Title` text: the editor and the renderer show
 * issue keys as chips (ISS-7), and the doc's mention links are synced from that text.
 * Sections are found by their H2 text; a template without one gets it appended.
 */

export interface PostmortemIncident {
  key: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: Date;
  mitigatedAt: Date | null;
  resolvedAt: Date | null;
  summary: string;
  serviceNames: string[];
}

export interface PostmortemTimelineEntry {
  at: Date;
  kind: IncidentTimelineKind;
  body: string;
}

export interface PostmortemFollowUp {
  key: string;
  title: string;
}

export interface PostmortemData {
  incident: PostmortemIncident;
  timeline: PostmortemTimelineEntry[];
  followUps: PostmortemFollowUp[];
}

/** `Postmortem — INC-3 Checkout down`. */
export function postmortemTitle(incidentKey: string, title: string): string {
  return `Postmortem — ${incidentKey} ${title}`;
}

/** Title of the parent page postmortems are filed under (created when missing). */
export const POSTMORTEMS_PARENT_TITLE = "Postmortems";

/** `2026-10-20 14:05 UTC`: unambiguous for readers in any time zone. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const KIND_PREFIX: Record<IncidentTimelineKind, string> = {
  note: "",
  action: "Action: ",
  status_change: "",
};

function cell(type: "tableHeader" | "tableCell", text: string): RichTextNode {
  return { type, content: [rt.paragraph(text || undefined)] };
}

function timelineTable(entries: PostmortemTimelineEntry[]): RichTextNode {
  const rows = entries.length > 0 ? entries : null;
  return {
    type: "table",
    content: [
      { type: "tableRow", content: [cell("tableHeader", "Time"), cell("tableHeader", "Event")] },
      ...(rows
        ? rows.map((entry) => ({
            type: "tableRow",
            content: [
              cell("tableCell", formatUtc(entry.at)),
              cell("tableCell", `${KIND_PREFIX[entry.kind]}${entry.body}`),
            ],
          }))
        : [{ type: "tableRow", content: [cell("tableCell", ""), cell("tableCell", "")] }]),
    ],
  };
}

function impactBullets(incident: PostmortemIncident): RichTextNode {
  const duration = formatDuration(incidentDurationMs(incident));
  const window = incident.resolvedAt
    ? `${formatUtc(incident.startedAt)} to ${formatUtc(incident.resolvedAt)}`
    : `since ${formatUtc(incident.startedAt)}, still ${INCIDENT_STATUS_LABELS[incident.status].toLowerCase()}`;
  const mitigated = incident.mitigatedAt
    ? ` (mitigated after ${formatDuration(incident.mitigatedAt.getTime() - incident.startedAt.getTime())})`
    : "";
  return rt.bullets(
    `Severity: ${INCIDENT_SEVERITY_LABELS[incident.severity]}`,
    `Duration: ${duration}${mitigated}, ${window}`,
    `Affected services: ${incident.serviceNames.length > 0 ? incident.serviceNames.join(", ") : "none recorded"}`,
    "Who was affected, and how badly.",
  );
}

function actionItems(followUps: PostmortemFollowUp[]): RichTextNode {
  return followUps.length > 0
    ? rt.checklist(...followUps.map((issue) => `${issue.key} ${issue.title}`))
    : rt.checklist("STK-… action item");
}

type SectionId = "summary" | "impact" | "timeline" | "actions";

function sectionOf(node: RichTextNode): SectionId | null {
  if (node.type !== "heading" || node.attrs?.level !== 2) return null;
  const text = (node.content ?? [])
    .map((child) => child.text ?? "")
    .join("")
    .trim()
    .toLowerCase();
  if (text === "summary") return "summary";
  if (text === "impact") return "impact";
  if (text === "timeline") return "timeline";
  if (text.startsWith("action items")) return "actions";
  return null;
}

const HEADINGS: Record<SectionId, string> = {
  summary: "Summary",
  impact: "Impact",
  timeline: "Timeline",
  actions: "Action items (linked issues)",
};

/** The postmortem doc: `template` (null → just the four sections) with them filled in. */
export function buildPostmortem(template: RichTextDoc | null, data: PostmortemData): RichTextDoc {
  const bodies: Record<SectionId, RichTextNode[]> = {
    summary: [
      rt.paragraph(
        data.incident.summary ||
          `${data.incident.key} ${data.incident.title}. What happened, in two sentences.`,
      ),
    ],
    impact: [impactBullets(data.incident)],
    timeline: [timelineTable(data.timeline)],
    actions: [actionItems(data.followUps)],
  };
  const out: RichTextNode[] = [];
  const filled = new Set<SectionId>();
  let skipping = false;
  for (const node of template?.content ?? []) {
    const section = sectionOf(node);
    if (section && !filled.has(section)) {
      out.push(node, ...bodies[section]);
      filled.add(section);
      skipping = true;
      continue;
    }
    // Any other H2 (or heading of level ≤ 2) ends the replaced section.
    if (node.type === "heading" && Number(node.attrs?.level ?? 1) <= 2) skipping = false;
    if (!skipping) out.push(node);
  }
  for (const section of ["summary", "impact", "timeline", "actions"] as const) {
    if (!filled.has(section)) out.push(rt.heading(2, HEADINGS[section]), ...bodies[section]);
  }
  return { type: "doc", content: out };
}
