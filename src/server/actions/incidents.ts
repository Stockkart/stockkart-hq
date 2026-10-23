"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult } from "@/lib/action-result";
import {
  addTimelineEntryInput,
  declareIncidentInput,
  editTimelineEntryInput,
  incidentIdInput,
  linkFollowUpInput,
  setIncidentServicesInput,
  setIncidentStatusInput,
  timelineEntryIdInput,
  unlinkFollowUpInput,
  updateIncidentInput,
  updateIncidentTimesInput,
} from "@/lib/incidents/schemas";
import { requireSession } from "@/server/auth/require-session";
import { incidentService } from "@/server/services";
import { type DeclaredIncident } from "@/server/services/incidents";

import { runAction } from "./action-runner";
import {
  INCIDENT_PAGE,
  INCIDENTS,
  ISSUE_PAGE,
  NOTIFICATIONS,
  refreshPages,
  SERVICE_PAGE,
  SERVICES,
} from "./refresh";

/**
 * Incident actions (INC-1/2). Each re-checks the session first (S-2: action ids can be
 * POSTed from anywhere), then validates its untrusted input with Zod, then calls the
 * service. Expected failures come back as `{ ok: false, error }`; a missing session throws.
 */

/** The list, the incident, and the service pages that count and list incidents. */
const incidentViews = () => refreshPages(INCIDENTS, INCIDENT_PAGE, SERVICES, SERVICE_PAGE);
const page = () => refreshPages(INCIDENT_PAGE);

export async function declareIncidentAction(
  input: unknown,
): Promise<ActionResult<DeclaredIncident>> {
  const session = await requireSession();
  return runAction(
    declareIncidentInput,
    input,
    (data) => incidentService.declareIncident(session.user.id, data),
    () => {
      incidentViews();
      refreshPages(NOTIFICATIONS);
    },
  );
}

export async function setIncidentStatusAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    setIncidentStatusInput,
    input,
    async (data) => {
      await incidentService.setStatus(session.user.id, data);
      return undefined;
    },
    incidentViews,
  );
}

export async function updateIncidentTimesAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    updateIncidentTimesInput,
    input,
    async (data) => {
      await incidentService.updateTimes(session.user.id, data);
      return undefined;
    },
    incidentViews,
  );
}

export async function updateIncidentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    updateIncidentInput,
    input,
    async (data) => {
      await incidentService.updateIncident(session.user.id, data);
      return undefined;
    },
    () => {
      incidentViews();
      refreshPages(NOTIFICATIONS);
    },
  );
}

export async function setIncidentServicesAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    setIncidentServicesInput,
    input,
    async (data) => {
      await incidentService.setServices(session.user.id, data);
      return undefined;
    },
    incidentViews,
  );
}

export async function addTimelineEntryAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return runAction(
    addTimelineEntryInput,
    input,
    (data) => incidentService.addTimelineEntry(session.user.id, data),
    page,
  );
}

export async function editTimelineEntryAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    editTimelineEntryInput,
    input,
    async (data) => {
      await incidentService.editTimelineEntry(session.user.id, data);
      return undefined;
    },
    page,
  );
}

export async function deleteTimelineEntryAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    timelineEntryIdInput,
    input,
    async (data) => {
      await incidentService.deleteTimelineEntry(session.user.id, data.entryId);
      return undefined;
    },
    page,
  );
}

/** INC-2: link an issue (by key) as a follow-up; the issue page shows "From incident". */
export async function linkFollowUpAction(
  input: unknown,
): Promise<ActionResult<{ linkId: string }>> {
  const session = await requireSession();
  return runAction(
    linkFollowUpInput,
    input,
    (data) => incidentService.linkFollowUp(session.user.id, data),
    () => refreshPages(INCIDENT_PAGE, ISSUE_PAGE),
  );
}

export async function unlinkFollowUpAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    unlinkFollowUpInput,
    input,
    async (data) => {
      await incidentService.unlinkFollowUp(session.user.id, data);
      return undefined;
    },
    () => refreshPages(INCIDENT_PAGE, ISSUE_PAGE),
  );
}

/** INC-2 "Create postmortem" (idempotent: an existing one is returned to open). */
export async function createPostmortemAction(
  input: unknown,
): Promise<ActionResult<{ docId: string; created: boolean }>> {
  const session = await requireSession();
  return runAction(
    incidentIdInput,
    input,
    (data) => incidentService.createPostmortem(session.user.id, data.incidentId),
    () => {
      refreshPages(INCIDENT_PAGE, ISSUE_PAGE);
      // The docs tree lives in the docs layout (like `refreshDocPages` in actions/docs.ts).
      revalidatePath("/[projectKey]/docs", "layout");
    },
  );
}
