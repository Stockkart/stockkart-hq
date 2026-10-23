import { GitBranch, Siren, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { IncidentStatusBadge, SeverityBadge } from "@/features/incidents/incident-badges";
import { RelativeTime } from "@/features/issue/client-utils";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { EnvironmentChips, QuickLinks, repoUrl } from "@/features/service-registry/service-bits";
import { ServiceDetailActions } from "@/features/service-registry/service-detail-actions";
import { ServiceLinksPanel } from "@/features/service-registry/service-links-panel";
import { formatIncidentKey } from "@/lib/incidents/constants";
import { incidentPath } from "@/lib/incidents/rules";
import { NO_SECRETS_NOTICE } from "@/lib/service-registry/constants";
import { isServiceSlug, servicesPath } from "@/lib/service-registry/slug";
import { requirePageSession } from "@/server/auth/require-session";
import { serviceRegistryQueries } from "@/server/services";
import { serviceIdBySlug } from "@/server/services/service-registry";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string; slug: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: decodeURIComponent(slug) };
}

/** SVC-1 service page: everything on the card, notes, incidents and linked docs/issues. */
export default async function ServicePage({ params, searchParams }: Props) {
  await requirePageSession();
  const { projectKey, slug: rawSlug } = await params;
  const { edit } = await searchParams;
  const slug = decodeURIComponent(rawSlug);
  const key = resolveProjectKey(projectKey, `/services/${rawSlug}`);
  if (!isServiceSlug(slug)) notFound();
  const projectId = projectIdByKey(key);
  const serviceId = serviceIdBySlug(projectId, slug);
  // ONE round trip: every query finds the project and the service by key/slug itself.
  const [project, service, incidents, links, users] = await Promise.all([
    requireProject(key),
    serviceRegistryQueries.getService(projectId, slug),
    serviceRegistryQueries.serviceIncidents(serviceId),
    serviceRegistryQueries.serviceLinks(serviceId),
    serviceRegistryQueries.userOptions(),
  ]);
  if (!service) notFound();
  const repoHref = repoUrl(service.repo);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={servicesPath(project.key)}
            className="text-sm text-muted-foreground hover:underline"
          >
            Services
          </Link>
          <h1 className="text-2xl font-semibold break-words">{service.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{service.slug}</p>
        </div>
        <ServiceDetailActions
          projectKey={project.key}
          service={service}
          users={users}
          initialEdit={edit === "1"}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {service.description ? (
            <p className="text-sm whitespace-pre-wrap">{service.description}</p>
          ) : null}
          <section aria-labelledby="service-envs" className="flex flex-col gap-2">
            <h2 id="service-envs" className="text-sm font-semibold">
              Environments
            </h2>
            {service.environments.length === 0 ? (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            ) : (
              <>
                <EnvironmentChips environments={service.environments} />
                <ul className="flex flex-col gap-1 text-sm">
                  {service.environments
                    .filter((env) => env.notes)
                    .map((env, index) => (
                      <li key={`${env.name}-${index}`}>
                        <span className="font-medium">{env.name}:</span> {env.notes}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </section>
          <section aria-labelledby="service-links" className="flex flex-col gap-2">
            <h2 id="service-links" className="text-sm font-semibold">
              Quick links
            </h2>
            {service.links.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None yet. Add app, logs, dashboard or DB console URLs with Edit.
              </p>
            ) : (
              <QuickLinks links={service.links} />
            )}
          </section>
          <section aria-labelledby="service-notes" className="flex flex-col gap-2">
            <h2 id="service-notes" className="text-sm font-semibold">
              Notes
            </h2>
            {service.notes ? (
              <p className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {service.notes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No notes. {NO_SECRETS_NOTICE}</p>
            )}
          </section>
          <section aria-labelledby="service-incidents" className="flex flex-col gap-2">
            <h2 id="service-incidents" className="flex items-center gap-1.5 text-sm font-semibold">
              <Siren aria-hidden="true" className="size-4" />
              Incidents
            </h2>
            {incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No incidents affected this service.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {incidents.map((incident) => (
                  <li key={incident.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <SeverityBadge severity={incident.severity} />
                    <Link
                      href={incidentPath(project.key, incident.number)}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatIncidentKey(incident.number)}
                      </span>{" "}
                      {incident.title}
                    </Link>
                    <IncidentStatusBadge status={incident.status} />
                    <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                      <RelativeTime date={incident.startedAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="flex flex-col gap-6 lg:border-l lg:pl-6">
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Runtime</dt>
            <dd>{service.runtime ?? "Not set"}</dd>
            <dt className="text-muted-foreground">Repo</dt>
            <dd className="min-w-0 truncate">
              {repoHref ? (
                <a
                  href={repoHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <GitBranch aria-hidden="true" className="size-3.5" />
                  {service.repo}
                  <span className="sr-only"> (GitHub, opens in a new tab)</span>
                </a>
              ) : (
                "Not set"
              )}
            </dd>
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="inline-flex items-center gap-1">
              <UserRound aria-hidden="true" className="size-3.5" />
              {service.ownerName ?? "No owner"}
            </dd>
            <dt className="text-muted-foreground">Updated</dt>
            <dd>
              <RelativeTime date={service.updatedAt} />
            </dd>
          </dl>
          <ServiceLinksPanel serviceId={service.id} projectKey={project.key} links={links} />
        </aside>
      </div>
    </div>
  );
}
