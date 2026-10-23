"use client";

import { FileText, Plus, Siren, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { searchIssueOptions } from "@/features/search/issue-picker-search";
import { docPath, type LinkedDocView } from "@/lib/docs/views";
import { type IncidentRefView } from "@/lib/incidents/views";
import {
  type IssueType,
  LINK_RELATION_LABELS,
  LINK_RELATIONS,
  type LinkRelation,
} from "@/lib/issues/constants";
import { issuePathForKey } from "@/lib/issues/keys";
import { LINK_RELATION_ORDER } from "@/lib/issues/links";
import { TITLE_MAX } from "@/lib/issues/schemas";
import { type ChildIssue, type LinkView, type MentionView } from "@/lib/issues/views";
import { addLinkAction, createIssueAction, removeLinkAction } from "@/server/actions/issues";

import { callAction } from "./client-utils";
import { IssueTypeIcon, PriorityLabel, StatusBadge } from "./issue-badges";

function IssueRow({ issue }: { issue: ChildIssue }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <IssueTypeIcon type={issue.type} />
      <Link
        href={issuePathForKey(issue.key)}
        className="flex min-w-0 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="font-mono text-xs text-muted-foreground">{issue.key}</span>
        <span className="truncate">{issue.title}</span>
      </Link>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <PriorityLabel priority={issue.priority} short />
        <StatusBadge name={issue.status.name} category={issue.status.category} />
      </span>
    </span>
  );
}

interface SubtasksProps {
  issueId: string;
  issueType: IssueType;
  projectKey: string;
  items: ChildIssue[];
}

/**
 * §5.4 subtasks. An epic's children are its stories/tasks (ISS-3), so for an epic this is
 * "Child issues" and "Add" creates a task under it; for everything else it creates a subtask.
 * Subtasks cannot have subtasks, so the section is hidden for them.
 */
export function Subtasks({ issueId, issueType, projectKey, items }: SubtasksProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  if (issueType === "subtask") return null;
  const isEpic = issueType === "epic";
  const heading = isEpic ? "Child issues" : "Subtasks";

  function add() {
    const value = title.trim();
    if (!value) return;
    startTransition(async () => {
      const created = await callAction(() =>
        createIssueAction({
          projectKey,
          title: value,
          type: isEpic ? "task" : "subtask",
          parentId: issueId,
        }),
      );
      if (created === null) return;
      setTitle("");
      // No router.refresh(): the action already re-rendered this page in its response.
    });
  }

  return (
    <section aria-labelledby={`${inputId}-heading`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id={`${inputId}-heading`} className="text-sm font-semibold">
          {heading}
          {items.length > 0 ? (
            <span className="ml-1 font-normal text-muted-foreground">
              {items.filter((item) => item.status.category === "done").length}/{items.length}
            </span>
          ) : null}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setAdding((value) => !value)}>
          <Plus aria-hidden="true" />
          Add<span className="sr-only"> {isEpic ? "child issue" : "subtask"}</span>
        </Button>
      </div>
      {items.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center px-3 py-1.5 text-sm">
              <IssueRow issue={item} />
            </li>
          ))}
        </ul>
      ) : !adding ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : null}
      {adding ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {isEpic ? "New child issue title" : "New subtask title"}
          </label>
          <Input
            id={inputId}
            autoFocus
            value={title}
            maxLength={TITLE_MAX}
            placeholder={isEpic ? "Task title" : "Subtask title"}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <Button type="submit" size="sm" disabled={pending || !title.trim()}>
            Add
          </Button>
        </form>
      ) : null}
    </section>
  );
}

interface LinksProps {
  issueId: string;
  projectKey: string;
  links: LinkView[];
  mentions: MentionView[];
  /** Docs that mention or link this issue (DOC-9). */
  docs?: LinkedDocView[];
  /** Incidents this issue is a follow-up of (INC-2). */
  incidents?: IncidentRefView[];
}

/** ISS-6 links, worded from this issue (inverse derived), plus where it is mentioned. */
export function Links({
  issueId,
  projectKey,
  links,
  mentions,
  docs = [],
  incidents = [],
}: LinksProps) {
  const [adding, setAdding] = useState(false);
  const [relation, setRelation] = useState<LinkRelation>("blocks");
  const [target, setTarget] = useState<{ key: string; label: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const ids = { heading: useId(), relation: useId(), key: useId() };

  const visible = links
    .filter((link) => !hidden.has(link.linkId))
    .sort((a, b) => LINK_RELATION_ORDER[a.relation] - LINK_RELATION_ORDER[b.relation]);

  /** Adds the link; a pick in the issue picker calls this at once (no extra Enter). */
  function add(key = target?.key) {
    if (!key || pending) return;
    startTransition(async () => {
      const result = await callAction(() => addLinkAction({ issueId, relation, targetKey: key }));
      if (result === null) return;
      setTarget(null);
      setAdding(false);
    });
  }

  async function remove(link: LinkView) {
    // Optimistic: hide at once, show again if the server refuses.
    setHidden((current) => new Set(current).add(link.linkId));
    const result = await callAction(() => removeLinkAction({ issueId, linkId: link.linkId }));
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
          Links
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setAdding((value) => !value)}>
          <Plus aria-hidden="true" />
          Link<span className="sr-only"> an issue</span>
        </Button>
      </div>

      {adding ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.relation} className="text-xs text-muted-foreground">
              This issue
            </label>
            <Select
              id={ids.relation}
              label="This issue"
              className="w-40"
              value={relation}
              options={LINK_RELATIONS.map((value) => ({
                value,
                label: LINK_RELATION_LABELS[value],
              }))}
              onChange={(next) => {
                if (next) setRelation(next);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.key} className="text-xs text-muted-foreground">
              Issue
            </label>
            <Combobox
              id={ids.key}
              label="Issue"
              className="w-64"
              value={target?.key ?? null}
              valueLabel={target?.label ?? null}
              placeholder={`Search, or type ${projectKey}-1`}
              searchPlaceholder="Key or words…"
              emptyText="No matching issue"
              promptText="Type a key or words to search"
              loadOptions={(query) => searchIssueOptions(query)}
              onChange={(key, option) => {
                setTarget(key && option ? { key, label: option.label } : null);
                if (key) add(key);
              }}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending || !target}>
            Add link
          </Button>
        </form>
      ) : null}

      {visible.length === 0 &&
      mentions.length === 0 &&
      docs.length === 0 &&
      incidents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No links.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {visible.map((link) => (
            <li key={link.linkId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {LINK_RELATION_LABELS[link.relation]}
              </span>
              <IssueRow issue={link.issue} />
              <button
                type="button"
                aria-label={`Remove link: ${LINK_RELATION_LABELS[link.relation]} ${link.issue.key}`}
                onClick={() => void remove(link)}
                className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
          {mentions.map((mention) => (
            <li
              key={`${mention.sourceKind}-${mention.issue.id}`}
              className="flex items-center gap-3 px-3 py-1.5 text-sm"
            >
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {mention.sourceKind === "comment" ? "mentioned in comment" : "mentioned in"}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <IssueTypeIcon type={mention.issue.type} />
                <Link
                  href={issuePathForKey(mention.issue.key)}
                  className="flex min-w-0 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {mention.issue.key}
                  </span>
                  <span className="truncate">{mention.issue.title}</span>
                </Link>
              </span>
            </li>
          ))}
          {docs.map((doc) => (
            <li key={`doc-${doc.id}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {doc.origin === "mention" ? "mentioned in doc" : "linked from doc"}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <Link
                  href={docPath(projectKey, doc.id)}
                  className="truncate rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {doc.title}
                </Link>
              </span>
            </li>
          ))}
          {incidents.map((incident) => (
            <li
              key={`incident-${incident.id}`}
              className="flex items-center gap-3 px-3 py-1.5 text-sm"
            >
              <span className="w-28 shrink-0 text-xs text-muted-foreground">From incident</span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Siren aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <Link
                  href={incident.href}
                  className="flex min-w-0 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="font-mono text-xs text-muted-foreground">{incident.key}</span>
                  <span className="truncate">{incident.title}</span>
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
