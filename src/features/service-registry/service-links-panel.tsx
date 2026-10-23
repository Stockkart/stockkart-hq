"use client";

import { CircleDot, FileText, Plus, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import { searchIssueOptions } from "@/features/search/issue-picker-search";
import { type ServiceLinkView } from "@/lib/service-registry/views";
import {
  linkServiceAction,
  searchServiceDocsAction,
  unlinkServiceAction,
} from "@/server/actions/service-registry";

type Target = "issue" | "doc";

/** "Linked" on the service page: docs (runbooks …) and issues, via `entity_links`. */
export function ServiceLinksPanel({
  serviceId,
  projectKey,
  links,
}: {
  serviceId: string;
  projectKey: string;
  links: ServiceLinkView[];
}) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<Target>("doc");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const ids = { heading: useId(), kind: useId(), pick: useId() };
  const visible = links.filter((link) => !hidden.has(link.linkId));

  function add(value: string) {
    startTransition(async () => {
      const result = await callAction(() =>
        linkServiceAction(
          target === "issue"
            ? { serviceId, target, issueKey: value }
            : { serviceId, target, docId: value },
        ),
      );
      if (result) setAdding(false);
    });
  }

  async function remove(link: ServiceLinkView) {
    setHidden((current) => new Set(current).add(link.linkId));
    const result = await callAction(() => unlinkServiceAction({ serviceId, linkId: link.linkId }));
    if (result === null) {
      setHidden((current) => {
        const next = new Set(current);
        next.delete(link.linkId);
        return next;
      });
    }
  }

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id={ids.heading} className="text-sm font-semibold">
          Docs and issues
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setAdding((value) => !value)}>
          <Plus aria-hidden="true" />
          Link<span className="sr-only"> a doc or issue</span>
        </Button>
      </div>
      {adding ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.kind} className="text-xs text-muted-foreground">
              Link a
            </label>
            <Select
              id={ids.kind}
              label="Link a"
              className="w-28"
              value={target}
              options={[
                { value: "doc", label: "Doc" },
                { value: "issue", label: "Issue" },
              ]}
              onChange={(next) => {
                if (next === "doc" || next === "issue") setTarget(next);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.pick} className="text-xs text-muted-foreground">
              {target === "issue" ? "Issue" : "Doc"}
            </label>
            <Combobox<string>
              key={target}
              id={ids.pick}
              label={target === "issue" ? "Issue" : "Doc"}
              className="w-72"
              value={null}
              disabled={pending}
              placeholder={
                target === "issue" ? `Search, or type ${projectKey}-1` : "Search by title"
              }
              searchPlaceholder={target === "issue" ? "Key or words…" : "Title…"}
              emptyText={target === "issue" ? "No matching issue" : "No matching doc"}
              loadOptions={async (query) => {
                if (target === "issue") return searchIssueOptions(query);
                const result = await searchServiceDocsAction({ projectKey, q: query });
                if (!result.ok) throw new Error(result.error);
                return result.data.map((doc) => ({ value: doc.id, label: doc.title }));
              }}
              onChange={(value) => {
                if (value) add(value);
              }}
            />
          </div>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing linked yet (runbooks, ADRs, issues).
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {visible.map((link) => {
            const Icon = link.kind === "doc" ? FileText : CircleDot;
            return (
              <li key={link.linkId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <Link href={link.href} className="min-w-0 flex-1 truncate hover:underline">
                  {link.label}
                </Link>
                <button
                  type="button"
                  aria-label={`Unlink ${link.label}`}
                  onClick={() => void remove(link)}
                  className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
