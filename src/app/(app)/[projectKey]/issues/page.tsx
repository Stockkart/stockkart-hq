import type { Metadata } from "next";

import { IssueList } from "@/features/issue/issue-list";
import { loadProjectFromRoute } from "@/features/issue/project-route";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries } from "@/server/services";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Issues · ${projectKey.toUpperCase()}` };
}

export default async function IssuesPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const project = await loadProjectFromRoute(projectKey, "/issues");
  const issues = await issueQueries.listIssues(project.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Issues</h1>
        <p className="text-sm text-muted-foreground">
          {issues.length} {issues.length === 1 ? "issue" : "issues"} · press{" "}
          <kbd className="rounded border px-1 font-mono text-xs">C</kbd> to create
        </p>
      </div>
      <IssueList issues={issues} projectKey={project.key} />
    </div>
  );
}
