import type { Metadata } from "next";

import { DocList } from "@/features/docs/doc-list";
import { DocsToolbar } from "@/features/docs/docs-toolbar";
import { docTree } from "@/features/docs/doc-route";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries } from "@/server/services";

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
  const key = resolveProjectKey(projectKey, "/docs");
  // One round trip, shared with the layout (same project and tree, cached per request).
  const [project, docs, projectKeys] = await Promise.all([
    requireProject(key),
    docTree(key),
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
