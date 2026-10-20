import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DocEditor } from "@/features/docs/doc-editor";
import { loadProjectFromRoute } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { docQueries, issueQueries } from "@/server/services";

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
  const project = await loadProjectFromRoute(projectKey, `/docs/${parsed.data}`);
  const doc = await docQueries.getDoc(project.id, parsed.data);
  if (!doc) notFound();

  const [ancestors, linkedIssues, versions, users, projectKeys, adrs, tree] = await Promise.all([
    docQueries.ancestors(doc.id),
    docQueries.linkedIssues(doc.id),
    docQueries.listVersions(doc.id),
    docQueries.listUsers(),
    issueQueries.listProjectKeys(),
    doc.type === "adr" ? docQueries.listAdrs(project.id) : Promise.resolve([]),
    docQueries.listTree(project.id),
  ]);

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
      adrs={adrs
        .filter((adr) => adr.id !== doc.id)
        .map((adr) => ({ id: adr.id, title: adr.title }))}
      childCount={tree.filter((item) => item.parentId === doc.id).length}
    />
  );
}
