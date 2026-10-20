import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DocEditor } from "@/features/docs/doc-editor";
import { docTree } from "@/features/docs/doc-route";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { docQueries, issueQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string; id: string }>;
}

const docId = z.uuid();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Doc · ${projectKey.toUpperCase()}` };
}

/** §5.5 doc editor at `/STK/docs/<id>`. */
export default async function DocPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey, id } = await params;
  const parsed = docId.safeParse(id);
  if (!parsed.success) notFound();
  const key = resolveProjectKey(projectKey, `/docs/${parsed.data}`);
  const projectId = projectIdByKey(key);
  const docUuid = parsed.data;
  // ONE round trip for the page and the docs layout: every query takes the project by key
  // and the doc by its id, so none waits for another. Rows for a doc that turns out not to
  // exist (or to be in another project) are simply not rendered: the page 404s.
  const [, doc, ancestors, linkedIssues, versions, users, projectKeys, adrs, tree] =
    await Promise.all([
      requireProject(key),
      docQueries.getDoc(projectId, docUuid),
      docQueries.ancestors(docUuid),
      docQueries.linkedIssues(docUuid),
      docQueries.listVersions(docUuid),
      docQueries.listUsers(),
      issueQueries.listProjectKeys(),
      docQueries.supersedeOptions(projectId, docUuid),
      docTree(key),
    ]);
  if (!doc) notFound();

  return (
    <DocEditor
      // A different doc is a different editor (fresh autosave state and version).
      key={doc.id}
      doc={doc}
      ancestors={ancestors}
      linkedIssues={linkedIssues}
      versions={versions}
      users={users}
      projectKeys={projectKeys}
      adrs={adrs}
      childCount={tree.filter((item) => item.parentId === doc.id).length}
    />
  );
}
