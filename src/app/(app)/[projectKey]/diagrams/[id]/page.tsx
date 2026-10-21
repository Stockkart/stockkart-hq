import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DiagramEditor } from "@/features/diagrams/diagram-editor";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { diagramQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string; id: string }>;
}

const diagramId = z.uuid();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Diagram · ${projectKey.toUpperCase()}` };
}

/** §5.6 diagram editor at `/STK/diagrams/<id>` (whiteboard or flow). */
export default async function DiagramPage({ params }: Props) {
  await requirePageSession();
  const { projectKey, id } = await params;
  const parsed = diagramId.safeParse(id);
  if (!parsed.success) notFound();
  const key = resolveProjectKey(projectKey, `/diagrams/${parsed.data}`);
  // ONE round trip: every query takes the project by key and the diagram by id.
  const [, diagram, versions, links] = await Promise.all([
    requireProject(key),
    diagramQueries.getDiagram(projectIdByKey(key), parsed.data),
    diagramQueries.listVersions(parsed.data),
    diagramQueries.links(parsed.data),
  ]);
  if (!diagram) notFound();

  // A different diagram is a different editor (fresh autosave state and version).
  return <DiagramEditor key={diagram.id} diagram={diagram} versions={versions} links={links} />;
}
