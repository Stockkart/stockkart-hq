"use client";

import { Eye, FileText, History, Plus, RotateCcw, SquareCheckBig, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { searchIssueOptions } from "@/features/search/issue-picker-search";
import { type DiagramLinkView, type DiagramVersionView } from "@/lib/diagrams/views";
import {
  linkDiagramAction,
  searchLinkableDocsAction,
  unlinkDiagramAction,
} from "@/server/actions/diagrams";

/** §5.6 side panel: Linked (issues, docs, embeds) and the DGM-4 version history. */
export function DiagramSidePanel({
  diagramId,
  projectKey,
  links,
  versions,
  currentVersion,
  canRestore,
  onPreview,
  onRestore,
}: {
  diagramId: string;
  projectKey: string;
  links: DiagramLinkView[];
  versions: DiagramVersionView[];
  currentVersion: number;
  /** Restoring needs everything saved first (it is locked on the current version). */
  canRestore: boolean;
  onPreview: (version: number) => void;
  onRestore: (version: number) => void;
}) {
  return (
    <aside className="flex flex-col gap-6 xl:sticky xl:top-6 xl:self-start xl:border-l xl:pl-6">
      <LinkedPanel diagramId={diagramId} projectKey={projectKey} links={links} />
      <section aria-labelledby="diagram-versions-heading" className="flex flex-col gap-2">
        <h2
          id="diagram-versions-heading"
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          <History aria-hidden="true" className="size-4" />
          History
        </h2>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions yet.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {versions.map((version) => (
              <li key={version.version} className="flex items-center gap-2">
                <span className="font-mono text-xs">v{version.version}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {version.authorName ?? "Unknown"} · <RelativeTime date={version.createdAt} />
                </span>
                <button
                  type="button"
                  aria-label={`Preview v${version.version}`}
                  title="Preview (read-only)"
                  onClick={() => onPreview(version.version)}
                  className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Eye aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Restore v${version.version}`}
                  title={
                    canRestore ? "Restore as a new version" : "Wait until your changes are saved"
                  }
                  disabled={!canRestore || version.version === currentVersion}
                  onClick={() => onRestore(version.version)}
                  className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          Kept on “Save version” and at most every 10 minutes while editing. Restoring adds a new
          version; history is never rewritten.
        </p>
      </section>
    </aside>
  );
}

const SOURCE_HEADINGS: Record<DiagramLinkView["source"], string> = {
  manual: "Links",
  embed: "Embedded in",
  incoming: "Linked from",
};

function LinkedPanel({
  diagramId,
  projectKey,
  links,
}: {
  diagramId: string;
  projectKey: string;
  links: DiagramLinkView[];
}) {
  const [adding, setAdding] = useState<"issue" | "doc" | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const ids = { heading: useId(), picker: useId() };
  const visible = links.filter((link) => !hidden.has(link.key));

  function add(input: { target: "issue"; issueKey: string } | { target: "doc"; docId: string }) {
    if (pending) return;
    startTransition(async () => {
      const result = await callAction(() => linkDiagramAction({ diagramId, ...input }));
      // The action re-rendered this page in its response, so the new link is in `links`.
      if (result !== null) setAdding(null);
    });
  }

  async function remove(link: DiagramLinkView) {
    if (!link.linkId) return;
    const linkId = link.linkId;
    // Optimistic: hide at once, show again if the server refuses.
    setHidden((current) => new Set(current).add(link.key));
    const result = await callAction(() => unlinkDiagramAction({ diagramId, linkId }));
    if (result === null) {
      setHidden((current) => {
        const next = new Set(current);
        next.delete(link.key);
        return next;
      });
    }
  }

  const groups = (["manual", "embed", "incoming"] as const)
    .map((source) => ({ source, items: visible.filter((link) => link.source === source) }))
    .filter((group) => group.items.length > 0);

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={ids.heading} className="text-sm font-semibold">
          Linked
        </h2>
        <span className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding(adding === "issue" ? null : "issue")}
          >
            <Plus aria-hidden="true" />
            Issue
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding(adding === "doc" ? null : "doc")}
          >
            <Plus aria-hidden="true" />
            Doc
          </Button>
        </span>
      </div>
      {adding ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.picker} className="text-xs text-muted-foreground">
            {adding === "issue" ? "Issue (key or words)" : "Doc (title)"}
          </label>
          <Combobox
            id={ids.picker}
            label={adding === "issue" ? "Link an issue" : "Link a doc"}
            className="w-full"
            align="end"
            value={null}
            placeholder={adding === "issue" ? `Search, or type ${projectKey}-1` : "Search docs…"}
            searchPlaceholder={adding === "issue" ? "Key or words…" : "Title…"}
            emptyText={adding === "issue" ? "No matching issue" : "No matching doc"}
            loadOptions={async (query) => {
              if (adding === "issue") return searchIssueOptions(query);
              const docs = await callAction(() =>
                searchLinkableDocsAction({ projectKey, q: query }),
              );
              return (docs ?? []).map((doc) => ({ value: doc.id, label: doc.title }));
            }}
            onChange={(value) => {
              if (!value) return;
              add(
                adding === "issue"
                  ? { target: "issue", issueKey: value }
                  : { target: "doc", docId: value },
              );
            }}
          />
        </div>
      ) : null}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Link an issue or doc, or embed this diagram in a doc.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.source} className="flex flex-col gap-1">
            <h3 className="text-xs text-muted-foreground">{SOURCE_HEADINGS[group.source]}</h3>
            <ul className="flex flex-col divide-y rounded-md border">
              {group.items.map((link) => (
                <li key={link.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  {link.kind === "issue" ? (
                    <SquareCheckBig aria-hidden="true" className="size-3.5 shrink-0" />
                  ) : (
                    <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                  )}
                  <Link
                    href={link.href}
                    className="min-w-0 flex-1 truncate rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {link.label}
                  </Link>
                  {link.source === "manual" && link.linkId ? (
                    <button
                      type="button"
                      aria-label={`Unlink ${link.label}`}
                      onClick={() => void remove(link)}
                      className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
