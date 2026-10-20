import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { issueQueries } from "@/server/services";

/**
 * Server components only (imports the database).
 *
 * Resolves the `[projectKey]` route segment: canonical upper case (redirects `/stk/…` to
 * `/STK/…`), 404 for anything that is not an existing, unarchived project.
 */
export function resolveProjectKey(rawKey: string, rest = ""): string {
  const key = decodeURIComponent(rawKey);
  const upper = key.toUpperCase();
  if (!PROJECT_KEY_PATTERN.test(upper)) notFound();
  if (upper !== key) redirect(`/${upper}${rest}`);
  return upper;
}

/**
 * The project by key, once per request: a layout and its page both ask (React `cache`).
 * Pages start it together with their other queries, which reference the project by key
 * (`projectIdByKey`), so the whole page is one round trip.
 */
const projectByKey = cache((key: string) => issueQueries.getProject(key));

/** The project, or a 404. */
export async function requireProject(key: string) {
  const project = await projectByKey(key);
  if (!project) notFound();
  return project;
}

export async function loadProjectFromRoute(rawKey: string, rest = "") {
  return requireProject(resolveProjectKey(rawKey, rest));
}
