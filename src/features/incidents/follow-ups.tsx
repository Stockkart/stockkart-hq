"use client";

import { Link2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { StatusBadge } from "@/features/issue/issue-badges";
import { callAction } from "@/features/issue/client-utils";
import { openQuickCreate } from "@/features/issue/quick-create-events";
import { searchIssueOptions } from "@/features/search/issue-picker-search";
import { INCIDENT_TITLE_MAX } from "@/lib/incidents/constants";
import { type FollowUpView } from "@/lib/incidents/views";
import { issuePathForKey } from "@/lib/issues/keys";
import { linkFollowUpAction, unlinkFollowUpAction } from "@/server/actions/incidents";

/**
 * INC-2 follow-up issues: "Create follow-up issue" opens quick create pre-filled
 * ("Follow-up INC-n: …") and links the new issue; or link an existing issue by key. Each
 * shows its status. Unlinking is optimistic with rollback.
 */
export function FollowUps({
  incidentId,
  incidentKey,
  incidentTitle,
  followUps,
}: {
  incidentId: string;
  incidentKey: string;
  incidentTitle: string;
  followUps: FollowUpView[];
}) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const ids = { heading: useId(), key: useId() };
  const visible = followUps.filter((item) => !hidden.has(item.linkId));

  function link(issueKey: string, after?: () => void) {
    startTransition(async () => {
      const result = await callAction(() => linkFollowUpAction({ incidentId, issueKey }));
      if (result === null) return;
      after?.();
      router.refresh();
    });
  }

  function createFollowUp() {
    const prefix = `Follow-up ${incidentKey}: `;
    openQuickCreate({
      title: `${prefix}${incidentTitle}`.slice(0, INCIDENT_TITLE_MAX),
      type: "task",
      onCreated: (issue) =>
        link(issue.key, () => toast.success(`${issue.key} linked as a follow-up`)),
    });
  }

  async function unlink(item: FollowUpView) {
    setHidden((current) => new Set(current).add(item.linkId));
    const result = await callAction(() =>
      unlinkFollowUpAction({ incidentId, linkId: item.linkId }),
    );
    if (result === null) {
      setHidden((current) => {
        const next = new Set(current);
        next.delete(item.linkId);
        return next;
      });
    }
  }

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={ids.heading} className="text-sm font-semibold">
          Follow-up issues
        </h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={createFollowUp}>
            <Plus aria-hidden="true" />
            Create follow-up issue
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLinking((value) => !value)}>
            <Link2 aria-hidden="true" />
            Link existing
          </Button>
        </div>
      </div>
      {linking ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.key} className="text-xs text-muted-foreground">
            Issue
          </label>
          <Combobox<string>
            id={ids.key}
            label="Issue"
            className="w-72"
            value={null}
            disabled={pending}
            placeholder="Search, or type STK-1"
            searchPlaceholder="Key or words…"
            emptyText="No matching issue"
            promptText="Type a key or words to search"
            loadOptions={(query) =>
              searchIssueOptions(query, { exclude: visible.map((item) => item.key) })
            }
            onChange={(key) => {
              if (key) link(key, () => setLinking(false));
            }}
          />
        </div>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No follow-ups yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {visible.map((item) => (
            <li key={item.linkId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <Link
                href={issuePathForKey(item.key)}
                className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
              >
                <span className="font-mono text-xs text-muted-foreground">{item.key}</span>
                <span className="truncate">{item.title}</span>
              </Link>
              <StatusBadge name={item.status.name} category={item.status.category} />
              <button
                type="button"
                aria-label={`Unlink ${item.key}`}
                onClick={() => void unlink(item)}
                className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
