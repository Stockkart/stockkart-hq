import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { FollowUps } from "@/features/incidents/follow-ups";
import { IncidentHeader } from "@/features/incidents/incident-header";
import { IncidentSidePanel } from "@/features/incidents/incident-side-panel";
import { IncidentSummary } from "@/features/incidents/incident-summary";
import { IncidentTimeline } from "@/features/incidents/incident-timeline";
import { RelativeTime } from "@/features/issue/client-utils";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { formatIncidentKey } from "@/lib/incidents/constants";
import { incidentActivityText } from "@/lib/incidents/history";
import { parseIncidentKey } from "@/lib/incidents/rules";
import { requirePageSession } from "@/server/auth/require-session";
import { docQueries, incidentQueries } from "@/server/services";
import { incidentIdByNumber } from "@/server/services/incident-queries";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string; key: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  return { title: decodeURIComponent(key).toUpperCase() };
}

/** INC-1/2 incident page: header and status, summary, timeline, follow-ups, side panel. */
export default async function IncidentPage({ params }: Props) {
  const session = await requirePageSession();
  const { projectKey, key } = await params;
  const rawKey = decodeURIComponent(key);
  const number = parseIncidentKey(rawKey);
  if (number === null) notFound();
  const canonical = formatIncidentKey(number);
  const projectRouteKey = resolveProjectKey(projectKey, `/incidents/${canonical}`);
  if (rawKey !== canonical) redirect(`/${projectRouteKey}/incidents/${canonical}`);

  // ONE round trip: every query finds the project by key and the incident by number.
  const projectId = projectIdByKey(projectRouteKey);
  const incidentId = incidentIdByNumber(projectId, number);
  const [project, incident, timeline, followUps, activity, services, users] = await Promise.all([
    requireProject(projectRouteKey),
    incidentQueries.getIncident(projectId, number),
    incidentQueries.timeline(incidentId),
    incidentQueries.followUps(incidentId),
    incidentQueries.activity(incidentId),
    incidentQueries.serviceOptions(projectId),
    docQueries.listUsers(),
  ]);
  if (!incident) notFound();
  const names = {
    users: new Map(users.map((user) => [user.id, user.name || user.email])),
    services: new Map(
      [...services, ...incident.services].map((service) => [service.id, service.name]),
    ),
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <IncidentHeader
        projectKey={project.key}
        incident={{
          id: incident.id,
          key: incident.key,
          title: incident.title,
          severity: incident.severity,
          status: incident.status,
        }}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <IncidentSummary incidentId={incident.id} summary={incident.summary} />
          <IncidentTimeline
            incidentId={incident.id}
            entries={timeline}
            currentUserId={session.user.id}
          />
          <FollowUps
            incidentId={incident.id}
            incidentKey={incident.key}
            incidentTitle={incident.title}
            followUps={followUps}
          />
          <section aria-labelledby="incident-history" className="flex flex-col gap-2">
            <h2 id="incident-history" className="text-sm font-semibold">
              History
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {activity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap gap-x-1 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {entry.actorName ?? "Someone"}
                  </span>
                  <span>{incidentActivityText(entry, names)}</span>
                  <span>·</span>
                  <RelativeTime date={entry.createdAt} />
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start lg:border-l lg:pl-6">
          <IncidentSidePanel
            projectKey={project.key}
            incident={incident}
            users={users}
            services={services}
            currentUserId={session.user.id}
          />
        </aside>
      </div>
    </div>
  );
}
