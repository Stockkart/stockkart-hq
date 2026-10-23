import type { Metadata } from "next";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { ServiceList } from "@/features/service-registry/service-list";
import { requirePageSession } from "@/server/auth/require-session";
import { serviceRegistryQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Services · ${projectKey.toUpperCase()}` };
}

/** SVC-1 service registry. */
export default async function ServicesPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const key = resolveProjectKey(projectKey, "/services");
  // ONE round trip: the list takes the project by key, so nothing waits for anything.
  const [project, services, users] = await Promise.all([
    requireProject(key),
    serviceRegistryQueries.listServices(projectIdByKey(key)),
    serviceRegistryQueries.userOptions(),
  ]);
  return <ServiceList projectKey={project.key} services={services} users={users} />;
}
