"use client";

import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { callAction } from "@/features/issue/client-utils";
import { createSprintRetroAction } from "@/server/actions/sprints";

/**
 * SPR-5 on a completed sprint's page: a link to its retro doc, or "Create retro" when it
 * was completed without one (auto retro off, or the doc was deleted). Creating is
 * idempotent on the server, so a double click still makes one doc; it opens the doc.
 */
export function RetroLink({
  projectKey,
  sprintId,
  sprintName,
  retroDocId,
}: {
  projectKey: string;
  sprintId: string;
  sprintName: string;
  retroDocId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (retroDocId) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/${projectKey}/docs/${retroDocId}`}>
          <FileText aria-hidden="true" />
          Retro<span className="sr-only"> of {sprintName}</span>
        </Link>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const retro = await callAction(() => createSprintRetroAction({ sprintId }));
          if (!retro) return;
          toast.success(retro.created ? "Retro created" : "This sprint already has a retro");
          router.push(`/${projectKey}/docs/${retro.docId}`);
        })
      }
    >
      <Plus aria-hidden="true" />
      {pending ? "Creating retro…" : "Create retro"}
      <span className="sr-only"> for {sprintName}</span>
    </Button>
  );
}
