import type { Metadata } from "next";

import { DocList } from "@/features/docs/doc-list";
import { docTree } from "@/features/docs/doc-route";
import { DocTree } from "@/features/docs/doc-tree";
import { DocsToolbar } from "@/features/docs/docs-toolbar";
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

/** DOC-2/3/4: the docs index, about navigation: the full page tree beside the list. */
export default async function DocsPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const key = resolveProjectKey(projectKey, "/docs");
  // One round trip: the queries find the project by key themselves.
  const [project, docs, projectKeys] = await Promise.all([
    requireProject(key),
    docTree(key),
    issueQueries.listProjectKeys(),
  ]);

  return (
    <div className="flex gap-6">
      <div className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-6 max-h-[calc(100dvh-6rem)] overflow-y-auto">
          <DocTree projectKey={project.key} docs={docs} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold">Docs</h1>
          <DocsToolbar projectKey={project.key} projectKeys={projectKeys} />
        </div>
        <DocList docs={docs} projectKey={project.key} />
      </div>
    </div>
  );
}
