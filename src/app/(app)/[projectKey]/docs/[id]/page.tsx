import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AttachmentsPanel } from "@/features/attachments/attachments-panel";
import { AttachmentUploadProvider } from "@/features/attachments/upload-context";
import { docTree } from "@/features/docs/doc-route";
import { DocScreen } from "@/features/docs/doc-screen";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { handbookConfigured } from "@/server/handbook";
import { commentService, docQueries, fileQueries, issueQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";
import { storageConfigured } from "@/server/storage";

interface Props {
  params: Promise<{ projectKey: string; id: string }>;
}

const docId = z.uuid();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Doc · ${projectKey.toUpperCase()}` };
}

/** §5.5 doc page at `/STK/docs/<id>`: read mode, or edit mode with `?edit=1` (docs UX). */
export default async function DocPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey, id } = await params;
  const parsed = docId.safeParse(id);
  if (!parsed.success) notFound();
  const key = resolveProjectKey(projectKey, `/docs/${parsed.data}`);
  const projectId = projectIdByKey(key);
  const docUuid = parsed.data;
  // ONE round trip: every query takes the project by key and the doc by its id, so none
  // waits for another. Rows for a doc that turns out not to
  // exist (or to be in another project) are simply not rendered: the page 404s.
  const [
    ,
    doc,
    ancestors,
    linkedIssues,
    versions,
    users,
    projectKeys,
    adrs,
    tree,
    attachments,
    threads,
    supersedes,
  ] = await Promise.all([
    requireProject(key),
    // The doc, with its DOC-14 handbook sync state in the same query (`doc.handbook`).
    docQueries.getDoc(projectId, docUuid),
    docQueries.ancestors(docUuid),
    docQueries.linkedIssues(docUuid),
    docQueries.listVersions(docUuid),
    docQueries.listUsers(),
    issueQueries.listProjectKeys(),
    docQueries.supersedeOptions(projectId, docUuid),
    docTree(key),
    // ISS-9 attachments panel; same batch.
    fileQueries.listAttachments("doc", docUuid),
    // DOC-11 / DOC-13 comment threads; same batch.
    commentService.listForDoc(docUuid),
    // ADR-3 "Supersedes ADR-0007" banner; same batch.
    docQueries.supersedes(docUuid),
  ]);
  if (!doc) notFound();
  const storageReady = storageConfigured();
  const target = { entityType: "doc", entityId: doc.id } as const;

  return (
    // Files pasted or dropped into the doc attach to it (ISS-9).
    <AttachmentUploadProvider target={target} storageReady={storageReady}>
      <DocScreen
        // A different doc is a different page state (mode, panels, the copy shown).
        key={doc.id}
        doc={doc}
        ancestors={ancestors}
        linkedIssues={linkedIssues}
        versions={versions}
        users={users}
        projectKeys={projectKeys}
        adrs={adrs}
        supersedes={supersedes}
        tree={tree}
        // DOC-14: from env only (no request); the sync state itself is `doc.handbook`.
        handbookConfigured={handbookConfigured()}
        comments={{
          threads,
          currentUser: { id: session.user.id, name: session.user.name ?? "You" },
        }}
        attachmentsPanel={
          <AttachmentsPanel
            target={target}
            attachments={attachments}
            currentUserId={session.user.id}
            storageReady={storageReady}
          />
        }
      />
    </AttachmentUploadProvider>
  );
}
