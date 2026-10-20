import type { Metadata } from "next";

import { AdrLog } from "@/features/docs/adr-log";
import { DocsToolbar } from "@/features/docs/docs-toolbar";
import { loadProjectFromRoute } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { docQueries, issueQueries } from "@/server/services";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `ADRs · ${projectKey.toUpperCase()}` };
}

/** ADR-4 log. */
export default async function AdrsPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const project = await loadProjectFromRoute(projectKey, "/adrs");
  const [rows, projectKeys] = await Promise.all([
    docQueries.listAdrs(project.id),
    issueQueries.listProjectKeys(),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Architecture decisions</h1>
        <DocsToolbar projectKey={project.key} projectKeys={projectKeys} show={["adr"]} />
      </div>
      <AdrLog rows={rows} projectKey={project.key} />
    </div>
  );
}
