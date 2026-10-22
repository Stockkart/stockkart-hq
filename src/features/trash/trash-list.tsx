"use client";

import { FileText, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { IssueTypeIcon } from "@/features/issue/issue-badges";
import { TRASH_DAYS, type TrashItem } from "@/lib/trash/views";
import { restoreFromTrashAction } from "@/server/actions/trash";

/**
 * ISS-13 trash: issues and docs deleted in the last 30 days, each with Restore. A restore
 * is optimistic (the row leaves at once; it comes back if the server refuses). An issue or
 * page whose parent is in the trash too comes back without it, and says so.
 */
export function TrashList({ projectKey, items }: { projectKey: string; items: TrashItem[] }) {
  const router = useRouter();
  const [shown, remove] = useOptimistic(items, (state, id: string) =>
    state.filter((item) => item.id !== id),
  );
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");

  function restore(item: TrashItem) {
    const name = item.kind === "issue" ? item.key : `“${item.title}”`;
    startTransition(async () => {
      remove(item.id);
      const result = await callAction(() =>
        restoreFromTrashAction({ projectKey, kind: item.kind, id: item.id }),
      );
      if (!result) {
        setAnnouncement(`${name} was not restored`);
        return;
      }
      const href =
        item.kind === "issue" && result.key
          ? `/${projectKey}/issues/${result.key}`
          : `/${projectKey}/docs/${item.id}`;
      const note = result.detachedFromParent
        ? item.kind === "issue"
          ? "Its parent is still deleted, so it is restored without a parent."
          : "Its parent page is still deleted, so it is back at the top level."
        : undefined;
      setAnnouncement(`Restored ${name}. ${note ?? ""}`);
      toast.success(`Restored ${name}`, {
        description: note,
        action: { label: "Open", onClick: () => router.push(href) },
      });
    });
  }

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {shown.length === 0 ? (
        <section className="rounded-lg border border-dashed p-8 text-center">
          <h2 className="font-medium">The trash is empty</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Deleted issues and docs show here for {TRASH_DAYS} days.
          </p>
        </section>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              {item.kind === "issue" ? (
                <IssueTypeIcon type={item.type} />
              ) : (
                <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
              )}
              <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                {item.kind === "issue" ? item.key : "Doc"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  Deleted <RelativeTime date={item.deletedAt} />
                  {item.deletedBy ? ` by ${item.deletedBy}` : null}
                  {item.parentDeleted
                    ? item.kind === "issue"
                      ? " · its parent is deleted too; it comes back without a parent"
                      : " · its parent page is deleted too; it comes back at the top level"
                    : null}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Restore ${item.kind === "issue" ? item.key : `doc ${item.title}`}`}
                onClick={() => restore(item)}
              >
                <RotateCcw aria-hidden="true" />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
