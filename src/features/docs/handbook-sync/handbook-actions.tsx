"use client";

import { GitPullRequestArrow, Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { canPull } from "@/lib/handbook/sync-state";
import { type HandbookDocSync } from "@/lib/handbook/views";

import { PublishDialog } from "./publish-dialog";
import { PullDialog } from "./pull-dialog";

/**
 * DOC-14 doc actions: "Publish to handbook" and "Review & pull". Self-contained, so the
 * docs-UX slice's "⋯" actions registry can take the two entries as they are. Without the
 * GitHub App the buttons are disabled with the reason (the actions fail closed anyway).
 */
export function HandbookActions({
  projectKey,
  sync,
  configured,
}: {
  projectKey: string;
  sync: HandbookDocSync;
  configured: boolean;
}) {
  const [dialog, setDialog] = useState<"publish" | "pull" | null>(null);
  const disabledReason = configured ? undefined : "Handbook sync isn't set up";
  const prOpen = sync.status === "pr_open";
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!configured || prOpen}
        title={disabledReason ?? (prOpen ? "A publish PR is already open" : undefined)}
        onClick={() => setDialog("publish")}
      >
        <GitPullRequestArrow aria-hidden="true" />
        Publish to handbook
      </Button>
      {canPull(sync.status) || sync.status === "removed_in_handbook" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!configured}
          title={disabledReason}
          onClick={() => setDialog("pull")}
        >
          <Download aria-hidden="true" />
          Review &amp; pull
        </Button>
      ) : null}
      {/* Mounted per opening, so each opening reads GitHub afresh. */}
      {dialog === "publish" ? (
        <PublishDialog
          open
          onOpenChange={(open) => setDialog(open ? "publish" : null)}
          projectKey={projectKey}
          docId={sync.docId}
          initialPath={sync.path}
        />
      ) : null}
      {dialog === "pull" ? (
        <PullDialog
          open
          onOpenChange={(open) => setDialog(open ? "pull" : null)}
          docId={sync.docId}
          onKeepHq={() => setDialog("publish")}
        />
      ) : null}
    </>
  );
}
