import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AttachmentsPanel } from "@/features/attachments/attachments-panel";
import { AttachmentUploadProvider } from "@/features/attachments/upload-context";
import { DevelopmentPanel } from "@/features/issue/development-panel";
import { IssueDescription } from "@/features/issue/issue-description";
import { IssueFields } from "@/features/issue/issue-fields";
import { IssueHeader } from "@/features/issue/issue-header";
import { Links, Subtasks } from "@/features/issue/issue-relations";
import { IssueTabs } from "@/features/issue/issue-tabs";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { RecordIssueView } from "@/features/issue/record-view";
import { WatchersPanel } from "@/features/issue/watchers-panel";
import { formatIssueKey, parseIssueKey } from "@/lib/issues/keys";
import { requirePageSession } from "@/server/auth/require-session";
import {
  commentService,
  docQueries,
  fileQueries,
  githubQueries,
  incidentQueries,
  issueQueries,
  watcherService,
} from "@/server/services";
import { issueIdByNumber, projectIdByKey } from "@/server/services/sql";
import { storageConfigured } from "@/server/storage";

interface Props {
  params: Promise<{ projectKey: string; key: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  return { title: decodeURIComponent(key).toUpperCase() };
}

/** ISS-5 issue detail, laid out as the §5.4 wireframe. */
export default async function IssuePage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey, key } = await params;
  const rawKey = decodeURIComponent(key);
  const ref = parseIssueKey(rawKey);
  if (!ref) notFound();
  const canonicalKey = formatIssueKey(ref.projectKey, ref.number);
  const projectRouteKey = resolveProjectKey(projectKey, `/issues/${canonicalKey}`);
  // The key's prefix must match the project in the path; `/STK/issues/stk-5` → canonical.
  if (ref.projectKey !== projectRouteKey) notFound();
  if (rawKey !== canonicalKey) redirect(`/${projectRouteKey}/issues/${canonicalKey}`);

  // ONE round trip: every query finds the project by key and the issue by number itself,
  // so none waits for another (they were three to five rounds before).
  const projectId = projectIdByKey(projectRouteKey);
  const issueId = issueIdByNumber(projectId, ref.number);
  const [
    project,
    issue,
    meta,
    children,
    links,
    mentions,
    comments,
    activity,
    projectKeys,
    subtaskParents,
    docs,
    development,
    watchers,
    attachments,
    incidents,
  ] = await Promise.all([
    requireProject(projectRouteKey),
    issueQueries.getIssue(projectId, ref.number),
    issueQueries.getProjectMeta(projectId),
    issueQueries.listChildren(issueId),
    issueQueries.listLinks(issueId),
    issueQueries.listMentionedIn(issueId),
    commentService.listForIssue(issueId),
    issueQueries.listActivity(issueId),
    issueQueries.listProjectKeys(),
    // Empty unless the issue is a subtask.
    issueQueries.listSubtaskParents(projectId, issueId),
    docQueries.docsLinkingTo(issueId),
    // GH-4 branches, PRs and commits; same batch.
    githubQueries.listDevelopment(issueId),
    // ISS-11 watchers; same batch.
    watcherService.list(issueId),
    // ISS-9 attachments panel; same batch.
    fileQueries.listAttachments("issue", issueId),
    // INC-2 "From incident INC-n"; same batch.
    incidentQueries.incidentsLinkingTo(issueId),
  ]);
  if (!issue) notFound();
  const parentOptions = issue.type === "subtask" ? subtaskParents : meta.epics;
  const storageReady = storageConfigured();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <RecordIssueView issueId={issue.id} />
      <IssueHeader
        issueId={issue.id}
        issueKey={issue.key}
        projectKey={project.key}
        type={issue.type}
        title={issue.title}
        convert={{
          type: issue.type,
          parentType: issue.parent?.type ?? null,
          childTypes: children.map((child) => child.type),
        }}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Files pasted into the description or a new comment attach to the issue (ISS-9). */}
        <AttachmentUploadProvider
          target={{ entityType: "issue", entityId: issue.id }}
          storageReady={storageReady}
        >
          <div className="flex min-w-0 flex-col gap-8">
            <IssueDescription
              issueId={issue.id}
              description={issue.description}
              projectKeys={projectKeys}
            />
            <AttachmentsPanel
              target={{ entityType: "issue", entityId: issue.id }}
              attachments={attachments}
              currentUserId={session.user.id}
              storageReady={storageReady}
            />
            <Subtasks
              issueId={issue.id}
              issueType={issue.type}
              projectKey={project.key}
              items={children}
            />
            <Links
              issueId={issue.id}
              projectKey={project.key}
              links={links}
              mentions={mentions}
              docs={docs}
              incidents={incidents}
            />
            <IssueTabs
              issueId={issue.id}
              comments={comments}
              activity={activity.entries}
              issueKeys={activity.issueKeys}
              meta={meta}
              projectKeys={projectKeys}
              currentUserId={session.user.id}
            />
          </div>
        </AttachmentUploadProvider>
        <div className="flex flex-col gap-8 lg:sticky lg:top-6 lg:self-start lg:border-l lg:pl-6">
          <IssueFields
            issue={issue}
            meta={meta}
            parentOptions={parentOptions}
            currentUserId={session.user.id}
          />
          <WatchersPanel
            issueId={issue.id}
            watchers={watchers}
            currentUser={{
              id: session.user.id,
              name: session.user.name || session.user.email,
              email: session.user.email,
            }}
          />
          <DevelopmentPanel development={development} />
        </div>
      </div>
    </div>
  );
}
