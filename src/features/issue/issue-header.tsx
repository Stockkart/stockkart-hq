"use client";

import { Check, GitBranch, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { ISSUE_TYPE_LABELS, type IssueType } from "@/lib/issues/constants";
import { type ConvertSubject } from "@/lib/issues/convert";
import { branchName } from "@/lib/issues/keys";
import { TITLE_MAX } from "@/lib/issues/schemas";
import { deleteIssueAction, updateIssueFieldAction } from "@/server/actions/issues";

import { callAction } from "./client-utils";
import { IssueActionsMenu } from "./issue-actions-menu";
import { IssueTypeIcon } from "./issue-badges";

interface IssueHeaderProps {
  issueId: string;
  issueKey: string;
  projectKey: string;
  type: IssueType;
  title: string;
  /** ISS-14 "Convert type": the parent's and the live children's types. */
  convert: ConvertSubject;
}

/** §5.4 header: key · type, inline-editable title, "Copy branch" (GH-5), "⋯" and delete. */
export function IssueHeader({
  issueId,
  issueKey,
  projectKey,
  type,
  title,
  convert,
}: IssueHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          <Link
            href={`/${projectKey}/issues`}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {projectKey} issues
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="font-mono text-muted-foreground" aria-current="page">
            {issueKey}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <IssueTypeIcon type={type} withLabel className="text-muted-foreground" />
        </nav>
        <div className="flex items-center gap-1">
          <CopyBranchButton branch={branchName(issueKey, title)} />
          <IssueActionsMenu
            issueId={issueId}
            issueKey={issueKey}
            projectKey={projectKey}
            subject={convert}
          />
          <DeleteIssueButton issueId={issueId} issueKey={issueKey} projectKey={projectKey} />
        </div>
      </div>
      <InlineTitle issueId={issueId} title={title} typeLabel={ISSUE_TYPE_LABELS[type]} />
    </header>
  );
}

function InlineTitle({
  issueId,
  title,
  typeLabel,
}: {
  issueId: string;
  title: string;
  typeLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  // Optimistic: show the new title at once; revert if the server refuses it.
  const [shown, setShown] = useState(title);
  const [draft, setDraft] = useState(title);
  const inputId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  // Follow the server title after a refresh (e.g. someone else renamed the issue).
  const [seenTitle, setSeenTitle] = useState(title);
  if (seenTitle !== title) {
    setSeenTitle(title);
    setShown(title);
  }

  async function save() {
    const next = draft.replace(/\s+/g, " ").trim();
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
    if (!next || next === shown) return;
    const previous = shown;
    setShown(next);
    const result = await callAction(() =>
      updateIssueFieldAction({ issueId, field: "title", value: next }),
    );
    if (result === null) setShown(previous);
  }

  if (editing) {
    return (
      <div>
        <label htmlFor={inputId} className="sr-only">
          {typeLabel} title
        </label>
        <Input
          id={inputId}
          autoFocus
          value={draft}
          maxLength={TITLE_MAX}
          className="h-auto py-1 text-2xl font-semibold md:text-2xl"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(shown);
              setEditing(false);
              requestAnimationFrame(() => editButton.current?.focus());
            }
          }}
        />
      </div>
    );
  }

  return (
    <h1 className="text-2xl font-semibold">
      <button
        ref={editButton}
        type="button"
        onClick={() => {
          setDraft(shown);
          setEditing(true);
        }}
        className="-mx-1 rounded-md px-1 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={`${shown}. Edit title`}
      >
        {shown}
      </button>
    </h1>
  );
}

function CopyBranchButton({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      title={branch}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(branch);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          toast.success("Branch name copied", { description: branch });
        } catch {
          // No clipboard permission (or not a secure context): show it so it can be copied.
          toast.info("Copy this branch name", { description: branch });
        }
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <GitBranch aria-hidden="true" />}
      Copy branch
      <span className="sr-only">: {branch}</span>
    </Button>
  );
}

function DeleteIssueButton({
  issueId,
  issueKey,
  projectKey,
}: {
  issueId: string;
  issueKey: string;
  projectKey: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${issueKey}`}
        title="Delete"
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {issueKey}?</DialogTitle>
            <DialogDescription>
              The issue disappears from lists and boards. Its key is never reused.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await callAction(() => deleteIssueAction({ issueId }));
                  if (result === null) return;
                  setOpen(false);
                  toast.success(`${issueKey} deleted`);
                  router.push(`/${projectKey}/issues`);
                })
              }
            >
              {pending ? "Deleting…" : "Delete issue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
