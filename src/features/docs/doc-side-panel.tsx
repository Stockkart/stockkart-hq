"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { IssueTypeIcon, StatusBadge } from "@/features/issue/issue-badges";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { searchIssueOptions } from "@/features/search/issue-picker-search";
import { type DocVersionView, type LinkedIssueView } from "@/lib/docs/views";
import { issuePathForKey } from "@/lib/issues/keys";
import { linkDocIssueAction, unlinkDocIssueAction } from "@/server/actions/docs";

interface DocSidePanelProps {
  docId: string;
  projectKey: string;
  linkedIssues: LinkedIssueView[];
  versions: DocVersionView[];
  createdAt: Date;
  updatedAt: Date;
  updatedByName: string | null;
  /** Shown first (the DOC-11/DOC-13 comments panel). */
  before?: ReactNode;
}

/** §5.5 side panel: Linked issues (DOC-9), version history (read-only) and details. */
export function DocSidePanel({
  docId,
  projectKey,
  linkedIssues,
  versions,
  createdAt,
  updatedAt,
  updatedByName,
  before,
}: DocSidePanelProps) {
  return (
    <aside className="flex flex-col gap-6 xl:sticky xl:top-6 xl:self-start xl:border-l xl:pl-6">
      {before}
      <LinkedIssues docId={docId} projectKey={projectKey} links={linkedIssues} />
      <section aria-labelledby="doc-versions-heading" className="flex flex-col gap-2">
        <h2 id="doc-versions-heading" className="text-sm font-semibold">
          History
        </h2>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions yet.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {versions.map((version) => (
              <li key={version.version} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs">v{version.version}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {version.authorName ?? "Import"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <RelativeTime date={version.createdAt} />
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          Kept on “Save version” and at most every 10 minutes while editing.
        </p>
      </section>
      <section aria-labelledby="doc-details-heading" className="flex flex-col gap-1 text-sm">
        <h2 id="doc-details-heading" className="text-sm font-semibold">
          Details
        </h2>
        <p className="text-muted-foreground">
          Updated <RelativeTime date={updatedAt} />
          {updatedByName ? ` by ${updatedByName}` : ""}
        </p>
        <p className="text-muted-foreground">
          Created <RelativeTime date={createdAt} />
        </p>
      </section>
    </aside>
  );
}

function LinkedIssues({
  docId,
  projectKey,
  links,
}: {
  docId: string;
  projectKey: string;
  links: LinkedIssueView[];
}) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<{ key: string; label: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const ids = { heading: useId(), key: useId() };

  // A mention and a manual link to the same issue show once; the manual one is removable.
  const byIssue = new Map<string, LinkedIssueView>();
  for (const link of links) {
    if (hidden.has(link.linkId)) continue;
    const existing = byIssue.get(link.issue.id);
    if (!existing || link.origin === "manual") byIssue.set(link.issue.id, link);
  }
  const visible = [...byIssue.values()];

  /** Links the issue; a pick in the issue picker calls this at once (no extra Enter). */
  function add(key = target?.key) {
    if (!key || pending) return;
    startTransition(async () => {
      const result = await callAction(() => linkDocIssueAction({ docId, issueKey: key }));
      if (result === null) return;
      setTarget(null);
      setAdding(false);
      // No router.refresh(): the action already re-rendered this page in its response.
    });
  }

  async function remove(link: LinkedIssueView) {
    // Optimistic: hide at once, show again if the server refuses.
    setHidden((current) => new Set(current).add(link.linkId));
    const result = await callAction(() => unlinkDocIssueAction({ docId, linkId: link.linkId }));
    if (result === null) {
      setHidden((current) => {
        const next = new Set(current);
        next.delete(link.linkId);
        return next;
      });
    }
    // On success the action has already re-rendered this page.
  }

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id={ids.heading} className="text-sm font-semibold">
          Linked issues
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setAdding((value) => !value)}>
          <Plus aria-hidden="true" />
          Link issue
        </Button>
      </div>
      {adding ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.key} className="text-xs text-muted-foreground">
              Issue
            </label>
            <Combobox
              id={ids.key}
              label="Issue"
              className="w-52"
              align="end"
              value={target?.key ?? null}
              valueLabel={target?.label ?? null}
              placeholder={`Search, or type ${projectKey}-1`}
              searchPlaceholder="Key or words…"
              emptyText="No matching issue"
              promptText="Type a key or words to search"
              loadOptions={(query) =>
                searchIssueOptions(query, { exclude: visible.map((link) => link.issue.key) })
              }
              onChange={(key, option) => {
                setTarget(key && option ? { key, label: option.label } : null);
                if (key) add(key);
              }}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending || !target}>
            Link
          </Button>
        </form>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None. Mention an issue as {projectKey}-123 in the text, or link one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {visible.map((link) => (
            <li key={link.linkId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <IssueTypeIcon type={link.issue.type} />
              <Link
                href={issuePathForKey(link.issue.key)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="font-mono text-xs text-muted-foreground">{link.issue.key}</span>
                <span className="truncate">{link.issue.title}</span>
              </Link>
              <StatusBadge name={link.issue.status.name} category={link.issue.status.category} />
              {link.origin === "manual" ? (
                <button
                  type="button"
                  aria-label={`Unlink ${link.issue.key}`}
                  onClick={() => void remove(link)}
                  className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ) : (
                <span
                  className="text-[10px] text-muted-foreground uppercase"
                  title="Mentioned in the text"
                >
                  mention
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
