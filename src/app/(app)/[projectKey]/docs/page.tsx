import type { Metadata } from "next";

import { DocList } from "@/features/docs/doc-list";
import { DocsToolbar } from "@/features/docs/docs-toolbar";
import { loadProjectFromRoute } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { docQueries, issueQueries } from "@/server/services";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Docs · ${projectKey.toUpperCase()}` };
}

/** DOC-2/3/4: the docs list; the tree is in the layout. */
export default async function DocsPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const project = await loadProjectFromRoute(projectKey, "/docs");
  const [docs, projectKeys] = await Promise.all([
    docQueries.listTree(project.id),
    issueQueries.listProjectKeys(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Docs</h1>
        <DocsToolbar projectKey={project.key} projectKeys={projectKeys} />
      </div>
      <DocList docs={docs} projectKey={project.key} />
    </div>
  );
}
