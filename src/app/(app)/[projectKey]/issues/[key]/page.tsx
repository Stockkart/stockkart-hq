import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { IssueDescription } from "@/features/issue/issue-description";
import { IssueFields } from "@/features/issue/issue-fields";
import { IssueHeader } from "@/features/issue/issue-header";
import { Links, Subtasks } from "@/features/issue/issue-relations";
import { IssueTabs } from "@/features/issue/issue-tabs";
import { loadProjectFromRoute } from "@/features/issue/project-route";
import { RecordIssueView } from "@/features/issue/record-view";
import { formatIssueKey, parseIssueKey } from "@/lib/issues/keys";
import { requirePageSession } from "@/server/auth/require-session";
import { commentService, issueQueries } from "@/server/services";

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
  const project = await loadProjectFromRoute(projectKey, `/issues/${canonicalKey}`);
  // The key's prefix must match the project in the path; `/STK/issues/stk-5` → canonical.
  if (ref.projectKey !== project.key) notFound();
  if (rawKey !== canonicalKey) redirect(`/${project.key}/issues/${canonicalKey}`);

  const issue = await issueQueries.getIssue(project.id, ref.number);
  if (!issue) notFound();

  const [meta, children, links, mentions, comments, activity, projectKeys, subtaskParents] =
    await Promise.all([
      issueQueries.getProjectMeta(project.id),
      issueQueries.listChildren(issue.id),
      issueQueries.listLinks(issue.id),
      issueQueries.listMentionedIn(issue.id),
      commentService.listForIssue(issue.id),
      issueQueries.listActivity(issue.id),
      issueQueries.listProjectKeys(),
      issue.type === "subtask"
        ? issueQueries.listSubtaskParents(project.id, issue.id)
        : Promise.resolve([]),
    ]);
  const parentOptions = issue.type === "subtask" ? subtaskParents : meta.epics;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <RecordIssueView issueId={issue.id} />
      <IssueHeader
        issueId={issue.id}
        issueKey={issue.key}
        projectKey={project.key}
        type={issue.type}
        title={issue.title}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <IssueDescription
            issueId={issue.id}
            description={issue.description}
            projectKeys={projectKeys}
          />
          <Subtasks
            issueId={issue.id}
            issueType={issue.type}
            projectKey={project.key}
            items={children}
          />
          <Links issueId={issue.id} projectKey={project.key} links={links} mentions={mentions} />
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
        <div className="lg:sticky lg:top-6 lg:self-start lg:border-l lg:pl-6">
          <IssueFields
            issue={issue}
            meta={meta}
            parentOptions={parentOptions}
            currentUserId={session.user.id}
          />
        </div>
      </div>
    </div>
  );
}
