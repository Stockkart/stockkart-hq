"use client";

import { EllipsisVertical, FileText, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { callAction } from "@/features/issue/client-utils";
import { type NotesOutcome, type ReleaseSummary } from "@/lib/releases/views";
import {
  createReleaseAction,
  deleteReleaseAction,
  generateReleaseNotesAction,
  markReleasedAction,
  reopenReleaseAction,
  updateReleaseAction,
} from "@/server/actions/releases";

import { DeleteReleaseDialog, MarkReleasedDialog, ReleaseFormDialog } from "./release-dialogs";
import { type ReleaseChange } from "./release-state";

type Dialog = "edit" | "delete" | "release" | null;

const NOTES_MESSAGES: Record<NotesOutcome, string> = {
  created: "Release notes created",
  updated: "Release notes updated",
  new_version: "Release notes updated; the earlier edits are in the doc's version history",
  unchanged: "Release notes are up to date",
};

/**
 * Edit / Mark released / Reopen / Delete / Generate notes for one release, with their
 * dialogs. Each confirmed action applies `onChange` optimistically inside the transition
 * that runs the server action (see `ReleaseChange`), so the list updates at once and rolls
 * back if the server refuses.
 */
export function ReleaseActions({
  projectKey,
  release,
  releases,
  onChange,
  onDeleted,
}: {
  projectKey: string;
  release: ReleaseSummary;
  /** Every release of the project (optimistic copy), for the move-open-issues target. */
  releases: readonly ReleaseSummary[];
  onChange: (change: ReleaseChange) => void;
  /** Called after a successful delete (the detail page leaves for the list). */
  onDeleted?: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const openChange = (which: Exclude<Dialog, null>) => (open: boolean) =>
    setDialog(open ? which : null);
  const targets = releases.filter(
    (other) =>
      other.state === "unreleased" && other.id !== release.id && !other.id.startsWith("new:"),
  );

  function run<T>(
    change: ReleaseChange | null,
    action: () => Promise<T | null>,
    done: (result: T) => void,
  ) {
    setDialog(null);
    startTransition(async () => {
      if (change) onChange(change);
      const result = await action();
      if (result !== null) done(result);
    });
  }

  function generateNotes() {
    run(
      null,
      () => callAction(() => generateReleaseNotesAction({ releaseId: release.id })),
      (result) => {
        const href = `/${projectKey}/docs/${result.docId}`;
        toast.success(NOTES_MESSAGES[result.outcome], {
          action: { label: "Open", onClick: () => router.push(href) },
        });
      },
    );
  }

  // A release still being created has no id yet.
  if (release.id.startsWith("new:")) return null;
  const label = `for ${release.name}`;

  return (
    <div className="flex items-center gap-1">
      {release.state === "unreleased" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Mark ${release.name} released`}
          onClick={() => setDialog("release")}
        >
          Mark released
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Reopen ${release.name}`}
          onClick={() =>
            run(
              { kind: "reopen", id: release.id },
              () => callAction(() => reopenReleaseAction({ releaseId: release.id })),
              () => toast.success(`${release.name} reopened`),
            )
          }
        >
          Reopen
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`More ${label}`}>
            <EllipsisVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>Edit…</DropdownMenuItem>
          <DropdownMenuItem disabled={pending} onSelect={generateNotes}>
            <FileText aria-hidden="true" />
            Generate release notes
          </DropdownMenuItem>
          {release.state === "unreleased" ? (
            <DropdownMenuItem onSelect={() => setDialog("delete")}>Delete…</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ReleaseFormDialog
        open={dialog === "edit"}
        onOpenChange={openChange("edit")}
        mode="edit"
        initial={{
          name: release.name,
          releaseDate: release.releaseDate,
          description: release.description,
        }}
        onConfirm={(values) =>
          run(
            { kind: "update", id: release.id, fields: values },
            () => callAction(() => updateReleaseAction({ releaseId: release.id, ...values })),
            () => toast.success(`${values.name} saved`),
          )
        }
      />
      <MarkReleasedDialog
        open={dialog === "release"}
        onOpenChange={openChange("release")}
        release={release}
        targets={targets}
        onConfirm={(openIssues) =>
          run(
            {
              kind: "release",
              id: release.id,
              at: new Date(),
              moveOpenTo: openIssues?.action === "move" ? openIssues.targetReleaseId : null,
            },
            async () => {
              const result = await callAction(() =>
                markReleasedAction({ releaseId: release.id, openIssues }),
              );
              // Refused (e.g. issues reopened since this page loaded): reload the tallies, so
              // the dialog offers "move" / "release anyway" on the next try.
              if (result === null) router.refresh();
              return result;
            },
            (result) =>
              toast.success(
                result.moved > 0
                  ? `${release.name} released; ${result.moved} open ${result.moved === 1 ? "issue" : "issues"} moved`
                  : `${release.name} released`,
              ),
          )
        }
      />
      {release.state === "unreleased" ? (
        <DeleteReleaseDialog
          open={dialog === "delete"}
          onOpenChange={openChange("delete")}
          release={release}
          onConfirm={(unsetIssues) =>
            run(
              { kind: "remove", id: release.id },
              () => callAction(() => deleteReleaseAction({ releaseId: release.id, unsetIssues })),
              () => {
                toast.success(`${release.name} deleted`);
                onDeleted?.();
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

/** REL-1 "Create release". */
export function CreateReleaseButton({
  projectKey,
  onChange,
}: {
  projectKey: string;
  onChange: (change: ReleaseChange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="sm" disabled={pending} onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Create release
      </Button>
      <ReleaseFormDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        initial={{ name: "", releaseDate: null, description: null }}
        onConfirm={(values) => {
          setOpen(false);
          startTransition(async () => {
            onChange({
              kind: "add",
              release: {
                id: `new:${values.name}`,
                ...values,
                state: "unreleased",
                releasedAt: null,
                total: { count: 0, points: 0 },
                done: { count: 0, points: 0 },
                notesDocId: null,
              },
            });
            const result = await callAction(() => createReleaseAction({ projectKey, ...values }));
            if (result) toast.success(`${values.name} created`);
          });
        }}
      />
    </>
  );
}
