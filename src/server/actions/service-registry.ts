"use server";

import { type ActionResult } from "@/lib/action-result";
import {
  addDefaultServicesInput,
  createServiceInput,
  linkServiceInput,
  moveServiceInput,
  serviceDocSearchInput,
  serviceIdInput,
  unlinkServiceInput,
  updateServiceInput,
} from "@/lib/service-registry/schemas";
import { requireSession } from "@/server/auth/require-session";
import { serviceRegistry, serviceRegistryQueries } from "@/server/services";
import { type SavedService } from "@/server/services/service-registry";

import { runAction } from "./action-runner";
import { INCIDENT_PAGE, INCIDENTS, refreshPages, SERVICE_PAGE, SERVICES } from "./refresh";

/**
 * Service registry actions (SVC-1). Each re-checks the session first (S-2: action ids can
 * be POSTed from anywhere), then validates its untrusted input with Zod (which includes the
 * "No secrets" heuristic and the safe-URL check), then calls the service, which checks
 * again. Expected failures come back as `{ ok: false, error }`; a missing session throws.
 */

const none = () => {};
/** Service names show on the incident pages too (affected services). */
const registry = () => refreshPages(SERVICES, SERVICE_PAGE, INCIDENTS, INCIDENT_PAGE);

export async function createServiceAction(input: unknown): Promise<ActionResult<SavedService>> {
  const session = await requireSession();
  return runAction(
    createServiceInput,
    input,
    (data) => serviceRegistry.createService(session.user.id, data),
    () => refreshPages(SERVICES),
  );
}

export async function updateServiceAction(input: unknown): Promise<ActionResult<SavedService>> {
  const session = await requireSession();
  return runAction(
    updateServiceInput,
    input,
    (data) => serviceRegistry.updateService(session.user.id, data),
    registry,
  );
}

export async function deleteServiceAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    serviceIdInput,
    input,
    async (data) => {
      await serviceRegistry.deleteService(session.user.id, data.serviceId);
      return undefined;
    },
    registry,
  );
}

export async function moveServiceAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    moveServiceInput,
    input,
    async (data) => {
      await serviceRegistry.moveService(session.user.id, data);
      return undefined;
    },
    () => refreshPages(SERVICES),
  );
}

/** "Add Stockkart defaults" (idempotent by slug). */
export async function addDefaultServicesAction(
  input: unknown,
): Promise<ActionResult<{ created: string[] }>> {
  const session = await requireSession();
  return runAction(
    addDefaultServicesInput,
    input,
    (data) => serviceRegistry.addDefaults(session.user.id, data.projectKey),
    () => refreshPages(SERVICES),
  );
}

export async function linkServiceAction(input: unknown): Promise<ActionResult<{ linkId: string }>> {
  const session = await requireSession();
  return runAction(
    linkServiceInput,
    input,
    (data) => serviceRegistry.link(session.user.id, data),
    () => refreshPages(SERVICE_PAGE),
  );
}

export async function unlinkServiceAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    unlinkServiceInput,
    input,
    async (data) => {
      await serviceRegistry.unlink(session.user.id, data);
      return undefined;
    },
    () => refreshPages(SERVICE_PAGE),
  );
}

/** "Linked" → doc picker. */
export async function searchServiceDocsAction(
  input: unknown,
): Promise<ActionResult<{ id: string; title: string }[]>> {
  await requireSession();
  return runAction(
    serviceDocSearchInput,
    input,
    (data) => serviceRegistryQueries.docOptions(data.projectKey, data.q),
    none,
  );
}
