import type { Metadata } from "next";

import { IncidentList } from "@/features/incidents/incident-list";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@/lib/incidents/constants";
import { incidentListFilterInput } from "@/lib/incidents/schemas";
import { requirePageSession } from "@/server/auth/require-session";
import { docQueries, incidentQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Incidents · ${projectKey.toUpperCase()}` };
}

const asList = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Only the known values of a list param; an unknown one is dropped, not the whole filter. */
const known = <T extends string>(values: readonly T[], raw: string | string[] | undefined): T[] =>
  values.filter((value) => asList(raw).includes(value));

/** INC-1 incident list, filtered by `?status=&severity=&service=` (unknown values ignored). */
export default async function IncidentsPage({ params, searchParams }: Props) {
  const session = await requirePageSession();
  const { projectKey } = await params;
  const query = await searchParams;
  const key = resolveProjectKey(projectKey, "/incidents");
  const parsed = incidentListFilterInput.safeParse({
    status: known(INCIDENT_STATUSES, query.status),
    severity: known(INCIDENT_SEVERITIES, query.severity),
    service: typeof query.service === "string" && query.service ? query.service : null,
  });
  const filter = parsed.success ? parsed.data : { status: [], severity: [], service: null };
  const projectId = projectIdByKey(key);
  // ONE round trip: every query takes the project by key.
  const [project, incidents, services, users] = await Promise.all([
    requireProject(key),
    incidentQueries.listIncidents(projectId, filter),
    incidentQueries.serviceOptions(projectId),
    docQueries.listUsers(),
  ]);
  return (
    <IncidentList
      projectKey={project.key}
      incidents={incidents}
      filter={filter}
      services={services}
      users={users}
      currentUserId={session.user.id}
    />
  );
}
