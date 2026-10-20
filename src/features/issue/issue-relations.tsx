"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  const router = useRouter();
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
      router.refresh();
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
}

/** ISS-6 links, worded from this issue (inverse derived), plus where it is mentioned. */
export function Links({ issueId, projectKey, links, mentions }: LinksProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [relation, setRelation] = useState<LinkRelation>("blocks");
  const [targetKey, setTargetKey] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const ids = { heading: useId(), relation: useId(), key: useId() };

  const visible = links
    .filter((link) => !hidden.has(link.linkId))
    .sort((a, b) => LINK_RELATION_ORDER[a.relation] - LINK_RELATION_ORDER[b.relation]);

  function add() {
    const key = targetKey.trim();
    if (!key) return;
    startTransition(async () => {
      const result = await callAction(() => addLinkAction({ issueId, relation, targetKey: key }));
      if (result === null) return;
      setTargetKey("");
      setAdding(false);
      router.refresh();
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
            <NativeSelect
              id={ids.relation}
              value={relation}
              onChange={(event) => {
                const next = LINK_RELATIONS.find((value) => value === event.target.value);
                if (next) setRelation(next);
              }}
            >
              {LINK_RELATIONS.map((value) => (
                <option key={value} value={value}>
                  {LINK_RELATION_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.key} className="text-xs text-muted-foreground">
              Issue key
            </label>
            <Input
              id={ids.key}
              autoFocus
              className="h-8 w-32 font-mono"
              placeholder={`${projectKey}-1`}
              value={targetKey}
              onChange={(event) => setTargetKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setAdding(false);
              }}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending || !targetKey.trim()}>
            Add link
          </Button>
        </form>
      ) : null}

      {visible.length === 0 && mentions.length === 0 ? (
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
        </ul>
      )}
    </section>
  );
}
