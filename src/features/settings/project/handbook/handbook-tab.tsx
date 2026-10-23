"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PublicRepoWarning } from "@/features/docs/handbook-sync/public-repo-warning";
import { HandbookStatusBadge } from "@/features/docs/handbook-sync/handbook-status-badge";
import { callAction } from "@/features/issue/client-utils";
import { docPath } from "@/lib/docs/views";
import { HANDBOOK_PUBLISH_MAX, type HandbookSyncStatus } from "@/lib/handbook/constants";
import { handbookErrorText } from "@/lib/handbook/github-errors";
import {
  type CheckOutcome,
  type HandbookConfigView,
  type HandbookDocSync,
  type HandbookPublicationView,
} from "@/lib/handbook/views";
import {
  handbookCheckAction,
  handbookImportFileAction,
  handbookPublishAction,
  handbookTestConnectionAction,
} from "@/server/actions/handbook";

/** Table filters (Settings → Handbook). */
export const HANDBOOK_FILTERS = {
  all: { label: "All", statuses: null },
  changed_in_hq: { label: "Changed in HQ", statuses: ["changed_in_hq", "both_changed"] },
  changed_in_handbook: {
    label: "Changed in handbook",
    statuses: ["changed_in_handbook", "both_changed", "removed_in_handbook"],
  },
  not_published: { label: "Not published", statuses: ["not_in_handbook"] },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly HandbookSyncStatus[] | null }
>;
export type HandbookFilter = keyof typeof HANDBOOK_FILTERS;

const STATE_LABELS: Record<HandbookPublicationView["state"], string> = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
  failed: "Failed",
};

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * DOC-14 Settings → Handbook: setup status with "Test connection" (a server action: a token
 * and the default branch, once a minute per project), the docs with their sync status (stored
 * state, no GitHub call while rendering), bulk "Publish selected" (one PR), "Check handbook
 * now" (a server action; once a minute per project), "New in handbook" imports and the recent
 * publications (a failed one shows its classified reason and code).
 */
export function HandbookTab({
  projectKey,
  config,
  docs,
  publications,
}: {
  projectKey: string;
  config: HandbookConfigView;
  docs: HandbookDocSync[];
  publications: HandbookPublicationView[];
}) {
  const router = useRouter();
  const ids = { ack: useId(), status: useId() };
  const [filter, setFilter] = useState<HandbookFilter>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [check, setCheck] = useState<CheckOutcome | null>(null);
  const [imported, setImported] = useState<ReadonlySet<string>>(new Set());
  const [connection, setConnection] = useState<{ ok: boolean; text: string } | null>(null);
  const [publishing, startPublishing] = useTransition();
  const [checking, startChecking] = useTransition();
  const [importing, startImporting] = useTransition();
  const [testing, startTesting] = useTransition();

  const visible = useMemo(() => {
    const statuses: readonly HandbookSyncStatus[] | null = HANDBOOK_FILTERS[filter].statuses;
    return statuses ? docs.filter((doc) => statuses.includes(doc.status)) : docs;
  }, [docs, filter]);
  const publishable = (doc: HandbookDocSync) =>
    doc.status !== "pr_open" && doc.status !== "in_sync";
  const chosen = docs.filter((doc) => selected.has(doc.docId));
  const tooMany = chosen.length > HANDBOOK_PUBLISH_MAX;

  function toggle(docId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(docId);
      else next.delete(docId);
      return next;
    });
  }

  function publish() {
    startPublishing(async () => {
      const outcome = await callAction(() =>
        handbookPublishAction({
          projectKey,
          docIds: chosen.map((doc) => doc.docId),
          // The confirm dialog's "fine for everyone on the internet" box (required to send).
          acknowledgedPublic: acknowledged,
        }),
      );
      if (!outcome) return;
      const parts = [
        outcome.pr ? `Opened PR #${outcome.pr.number} with ${outcome.published.length} docs.` : "",
        outcome.unchanged.length > 0 ? `${outcome.unchanged.length} already matched.` : "",
        ...outcome.refused.map((item) => `${item.title}: ${item.reason}.`),
      ].filter(Boolean);
      setMessage(parts.join(" ") || "Nothing to publish.");
      if (outcome.pr) toast.success(`Opened PR #${outcome.pr.number}`);
      setConfirming(false);
      setSelected(new Set());
      router.refresh();
    });
  }

  /** "Test connection": shown inline (✓ or the classified reason) and as a toast. */
  function testConnection() {
    // Cleared first, so the live region announces a repeated result too.
    setConnection(null);
    startTesting(async () => {
      let text: string;
      let ok = false;
      try {
        const result = await handbookTestConnectionAction({ projectKey });
        ok = result.ok;
        text = result.ok
          ? `✓ Connected to ${result.data.repo} (default branch ${result.data.defaultBranch}).`
          : result.error;
      } catch {
        text = "Something went wrong. Reload the page and try again.";
      }
      setConnection({ ok, text });
      if (ok) toast.success("GitHub connection works");
      else toast.error(text);
    });
  }

  function checkNow() {
    startChecking(async () => {
      const outcome = await callAction(() => handbookCheckAction({ projectKey }));
      if (!outcome) return;
      setCheck(outcome);
      setMessage(
        `Checked ${outcome.checked} docs: ${outcome.drifted} changed in the handbook, ${outcome.newFiles.length} new files.`,
      );
      router.refresh();
    });
  }

  function importFile(path: string) {
    startImporting(async () => {
      const created = await callAction(() => handbookImportFileAction({ projectKey, path }));
      if (!created) return;
      setImported((current) => new Set(current).add(path));
      toast.success(`Imported ${path}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${ids.status}-config`} className="flex flex-col gap-2">
        <h2 id={`${ids.status}-config`} className="text-lg font-semibold">
          Engineering handbook
        </h2>
        <p className="text-sm">
          Repo:{" "}
          <a
            href={config.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono underline-offset-4 hover:underline"
          >
            {config.repo}
          </a>{" "}
          ·{" "}
          {config.configured ? (
            <span className="text-emerald-700 dark:text-emerald-400">GitHub App configured</span>
          ) : (
            <span className="text-destructive">Handbook sync isn&apos;t set up</span>
          )}
        </p>
        {config.configured ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={testing} onClick={testConnection}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <p
              aria-live="polite"
              className={
                connection?.ok === false
                  ? "text-sm text-destructive"
                  : "text-sm text-emerald-700 dark:text-emerald-400"
              }
            >
              {connection?.text ?? ""}
            </p>
          </div>
        ) : null}
        {config.configured ? null : (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Set up (an org owner, once):</p>
            <ol className="ml-5 list-decimal">
              <li>
                Create a GitHub App owned by the Stockkart org (no webhook: the org webhook already
                delivers events).
              </li>
              <li>
                Permissions: Contents read &amp; write, Pull requests read &amp; write, Metadata
                read.
              </li>
              <li>
                Install it on the engineering-handbook repo only; note the App ID and the
                installation ID.
              </li>
              <li>Generate a private key.</li>
              <li>
                In Vercel set GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY and
                HANDBOOK_REPO, then redeploy.
              </li>
              <li>
                Make sure the org webhook covers the handbook repo (pushes and pull requests).
              </li>
            </ol>
            <p className="mt-1 text-muted-foreground">
              README “Engineering handbook sync” has the details.
            </p>
          </div>
        )}
      </section>

      <p id={ids.status} aria-live="polite" className="text-sm">
        {message}
      </p>

      <section aria-label="Docs" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter docs" className="flex flex-wrap gap-1">
            {(Object.keys(HANDBOOK_FILTERS) as HandbookFilter[]).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "secondary" : "ghost"}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {HANDBOOK_FILTERS[key].label}
              </Button>
            ))}
          </div>
          <span className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!config.configured || checking}
              onClick={checkNow}
            >
              {checking ? "Checking…" : "Check handbook now"}
            </Button>
            <Button
              size="sm"
              disabled={!config.configured || chosen.length === 0 || tooMany}
              title={tooMany ? `At most ${HANDBOOK_PUBLISH_MAX} docs per PR` : undefined}
              onClick={() => {
                setAcknowledged(false);
                setConfirming(true);
              }}
            >
              Publish selected ({chosen.length})
            </Button>
          </span>
        </div>
        {tooMany ? (
          <p className="text-sm text-destructive">Select at most {HANDBOOK_PUBLISH_MAX} docs.</p>
        ) : null}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="w-8 py-1">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col" className="py-1">
                Doc
              </th>
              <th scope="col" className="py-1">
                Path
              </th>
              <th scope="col" className="py-1">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((doc) => (
              <tr key={doc.docId} className="border-t">
                <td className="py-1">
                  <input
                    type="checkbox"
                    aria-label={`Select ${doc.title}`}
                    disabled={!publishable(doc)}
                    checked={selected.has(doc.docId)}
                    onChange={(event) => toggle(doc.docId, event.target.checked)}
                  />
                </td>
                <td className="py-1">
                  <Link href={docPath(projectKey, doc.docId)} className="hover:underline">
                    {doc.title}
                  </Link>
                </td>
                <td className="py-1 font-mono text-xs">{doc.path}</td>
                <td className="py-1">
                  <HandbookStatusBadge status={doc.status} pr={doc.pr} />
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-2 text-muted-foreground">
                  No docs match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section aria-labelledby={`${ids.status}-new`} className="flex flex-col gap-2">
        <h3 id={`${ids.status}-new`} className="font-semibold">
          New in handbook
        </h3>
        {check === null ? (
          <p className="text-sm text-muted-foreground">
            Run “Check handbook now” to list handbook files no doc maps to.
          </p>
        ) : check.newFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every handbook file has a doc.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {check.newFiles.map((file) => (
              <li key={file.path} className="flex items-center gap-2 text-sm">
                <code className="font-mono text-xs">{file.path}</code>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importing || imported.has(file.path)}
                  onClick={() => importFile(file.path)}
                >
                  {imported.has(file.path) ? "Imported" : "Import"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${ids.status}-pubs`} className="flex flex-col gap-2">
        <h3 id={`${ids.status}-pubs`} className="font-semibold">
          Recent publications
        </h3>
        {publications.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing published from HQ yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {publications.map((pub) => (
              <li key={pub.id} className="flex flex-wrap items-center gap-2">
                {pub.prUrl ? (
                  <a
                    href={pub.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-4 hover:underline"
                  >
                    PR #{pub.prNumber}
                  </a>
                ) : (
                  <code className="font-mono text-xs">{pub.branch}</code>
                )}
                <span>{STATE_LABELS[pub.state]}</span>
                {pub.errorCode ? (
                  <span className="text-destructive">
                    {handbookErrorText(pub.errorCode, { repo: config.repo })}
                  </span>
                ) : null}
                <span className="text-muted-foreground">
                  {pub.docCount} {pub.docCount === 1 ? "doc" : "docs"}
                  {pub.createdByName ? ` · ${pub.createdByName}` : ""} ·{" "}
                  <time dateTime={pub.createdAt.toISOString()}>{day(pub.createdAt)}</time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish {chosen.length} docs to the handbook</DialogTitle>
            <DialogDescription>
              One pull request with every selected doc. Docs changed in the handbook since their
              last sync are left out (review and pull them first).
            </DialogDescription>
          </DialogHeader>
          <PublicRepoWarning />
          <ul className="max-h-48 overflow-auto text-sm">
            {chosen.map((doc) => (
              <li key={doc.docId}>
                <code className="font-mono text-xs">{doc.path}</code> · {doc.title}
              </li>
            ))}
          </ul>
          <label htmlFor={ids.ack} className="flex items-start gap-2 text-sm">
            <input
              id={ids.ack}
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I checked these docs: they are fine for everyone on the internet to read.</span>
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" disabled={!acknowledged || publishing} onClick={publish}>
              {publishing ? "Opening PR…" : "Open pull request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
