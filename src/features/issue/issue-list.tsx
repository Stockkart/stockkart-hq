import Link from "next/link";

import { type IssueListItem } from "@/lib/issues/views";

import { Avatar, IssueTypeIcon, PriorityLabel, StatusBadge } from "./issue-badges";

/**
 * VW-1 basic form: a sorted (newest first) table of the project's issues. Filters, sorting
 * and URL state arrive with the list-view slice.
 */
export function IssueList({ issues, projectKey }: { issues: IssueListItem[]; projectKey: string }) {
  if (issues.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="font-medium">No issues yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Press <kbd className="rounded border px-1 font-mono text-xs">C</kbd> or use “Create” in
          the top bar to add the first one.
        </p>
      </section>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">Issues in {projectKey}, newest first</caption>
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-24 px-3 py-2 font-medium">
              Key
            </th>
            <th scope="col" className="w-10 px-1 py-2 font-medium">
              <span className="sr-only">Type</span>
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="w-36 px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="w-24 px-3 py-2 font-medium">
              Priority
            </th>
            <th scope="col" className="w-44 px-3 py-2 font-medium">
              Assignee
            </th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => {
            const href = `/${projectKey}/issues/${issue.key}`;
            return (
              <tr key={issue.id} className="border-b last:border-b-0 hover:bg-muted/40">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                  <Link href={href} tabIndex={-1} className="hover:underline">
                    {issue.key}
                  </Link>
                </td>
                <td className="px-1 py-2">
                  <IssueTypeIcon type={issue.type} />
                </td>
                <td className="max-w-0 px-3 py-2">
                  <Link
                    href={href}
                    className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="sr-only">{issue.key}: </span>
                    {issue.title}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge name={issue.status.name} category={issue.status.category} />
                </td>
                <td className="px-3 py-2">
                  <PriorityLabel priority={issue.priority} short />
                </td>
                <td className="px-3 py-2">
                  {issue.assignee ? (
                    <span className="flex items-center gap-2">
                      <Avatar name={issue.assignee.name} />
                      <span className="truncate">{issue.assignee.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
