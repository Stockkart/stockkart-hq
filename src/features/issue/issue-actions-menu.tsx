"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { ISSUE_TYPE_LABELS, ISSUE_TYPES, type IssueType } from "@/lib/issues/constants";
import { type ConvertSubject, convertProblem } from "@/lib/issues/convert";
import { cloneIssueAction, convertIssueTypeAction } from "@/server/actions/issues";

import { callAction } from "./client-utils";
import { IssueTypeGlyph } from "./issue-badges";

/**
 * ISS-14: the issue page's "⋯" menu. "Clone" makes the copy and opens it; "Convert type…"
 * picks a new type, telling why a type is not allowed (ISS-3 parent rules) before the
 * server is asked; the server checks the same rules again.
 */
export function IssueActionsMenu({
  issueId,
  issueKey,
  projectKey,
  subject,
}: {
  issueId: string;
  issueKey: string;
  projectKey: string;
  subject: ConvertSubject;
}) {
  const router = useRouter();
  const [converting, setConverting] = useState(false);
  const [pending, startTransition] = useTransition();

  function clone() {
    startTransition(async () => {
      const created = await callAction(() => cloneIssueAction({ issueId }));
      if (!created) return;
      toast.success(`Cloned ${issueKey} as ${created.key}`);
      router.push(`/${projectKey}/issues/${created.key}`);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`More actions for ${issueKey}`}
            title="More actions"
            disabled={pending}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={clone}>Clone</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConverting(true)}>Convert type…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {converting ? (
        <ConvertTypeDialog
          issueId={issueId}
          issueKey={issueKey}
          subject={subject}
          onClose={() => setConverting(false)}
        />
      ) : null}
    </>
  );
}

function ConvertTypeDialog({
  issueId,
  issueKey,
  subject,
  onClose,
}: {
  issueId: string;
  issueKey: string;
  subject: ConvertSubject;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<IssueType | null>(null);
  const [pending, startTransition] = useTransition();
  const pickerId = useId();
  const problemId = useId();
  const problem = target ? convertProblem(subject, target) : null;
  const options: SelectOption<IssueType>[] = ISSUE_TYPES.filter(
    (type) => type !== subject.type,
  ).map((type) => ({
    value: type,
    label: ISSUE_TYPE_LABELS[type],
    icon: <IssueTypeGlyph type={type} />,
    detail: convertProblem(subject, type) ? "not allowed" : undefined,
  }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert {issueKey}</DialogTitle>
          <DialogDescription>
            It is {subject.type === "epic" ? "an" : "a"}{" "}
            {ISSUE_TYPE_LABELS[subject.type].toLowerCase()}. The change is recorded in its history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={pickerId}>New type</Label>
          <Select
            id={pickerId}
            label="New type"
            value={target}
            placeholder="Pick a type"
            options={options}
            aria-describedby={problemId}
            aria-invalid={problem ? true : undefined}
            onChange={setTarget}
          />
          <p
            id={problemId}
            role="alert"
            aria-live="polite"
            className="min-h-5 text-sm text-destructive"
          >
            {problem}
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            disabled={!target || problem !== null || pending}
            onClick={() =>
              startTransition(async () => {
                if (!target) return;
                const result = await callAction(() =>
                  convertIssueTypeAction({ issueId, type: target }),
                );
                if (result === null) return;
                const label = ISSUE_TYPE_LABELS[target].toLowerCase();
                toast.success(`${issueKey} is now ${target === "epic" ? "an" : "a"} ${label}`);
                onClose();
              })
            }
          >
            {pending ? "Converting…" : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
