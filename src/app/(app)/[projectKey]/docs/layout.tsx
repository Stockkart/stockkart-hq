import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { docTree } from "@/features/docs/doc-route";
import { DocTree } from "@/features/docs/doc-tree";
import { requireProject } from "@/features/issue/project-route";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { requirePageSession } from "@/server/auth/require-session";

interface Props {
  children: ReactNode;
  params: Promise<{ projectKey: string }>;
}

/** DOC-2: the page tree beside every docs page (the list and each doc). */
export default async function DocsLayout({ children, params }: Props) {
  // Layouts and pages render in parallel, so the layout checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  // No canonical-case redirect here: the layout does not know the rest of the path, so the
  // page does it (`loadProjectFromRoute`); the layout only needs the project.
  const key = decodeURIComponent(projectKey).toUpperCase();
  if (!PROJECT_KEY_PATTERN.test(key)) notFound();
  // Both in the page's round trip: the page asks for the same two (cached per request).
  const [project, tree] = await Promise.all([requireProject(key), docTree(key)]);

  return (
    <div className="mx-auto flex max-w-7xl gap-6">
      <div className="hidden w-60 shrink-0 lg:block">
        <div className="sticky top-6 max-h-[calc(100dvh-6rem)] overflow-y-auto">
          <DocTree projectKey={project.key} docs={tree} />
        </div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
