import type { Metadata } from "next";

import { DiagramList } from "@/features/diagrams/diagram-list";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { diagramQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Diagrams · ${projectKey.toUpperCase()}` };
}

/** §5.6 / DGM-*: the diagram grid, searchable by title and labels (`?q=`). */
export default async function DiagramsPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const { q } = await searchParams;
  const key = resolveProjectKey(projectKey, "/diagrams");
  const query = (typeof q === "string" ? q : "").slice(0, 200);
  // ONE round trip: the list takes the project by key, so neither waits for the other.
  const [project, cards] = await Promise.all([
    requireProject(key),
    diagramQueries.listDiagrams(projectIdByKey(key), query),
  ]);

  return <DiagramList projectKey={project.key} diagrams={cards} query={query} />;
}
