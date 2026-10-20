import { notFound, redirect } from "next/navigation";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { issueQueries } from "@/server/services";

/**
 * Server components only (imports the database).
 *
 * Resolves the `[projectKey]` route segment: canonical upper case (redirects `/stk/…` to
 * `/STK/…`), 404 for anything that is not an existing, unarchived project.
 */
export async function loadProjectFromRoute(rawKey: string, rest = "") {
  const key = decodeURIComponent(rawKey);
  const upper = key.toUpperCase();
  if (!PROJECT_KEY_PATTERN.test(upper)) notFound();
  if (upper !== key) redirect(`/${upper}${rest}`);
  const project = await issueQueries.getProject(upper);
  if (!project) notFound();
  return project;
}
