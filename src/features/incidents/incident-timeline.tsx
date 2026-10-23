"use client";

import { Activity, Hammer, Pencil, StickyNote, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import { INCIDENT_TIMELINE_BODY_MAX, type IncidentTimelineKind } from "@/lib/incidents/constants";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/incidents/datetime";
import { type TimelineEntryView } from "@/lib/incidents/views";
import { cn } from "@/lib/utils";
import {
  addTimelineEntryAction,
  deleteTimelineEntryAction,
  editTimelineEntryAction,
} from "@/server/actions/incidents";

const KIND_ICONS: Record<IncidentTimelineKind, typeof StickyNote> = {
  note: StickyNote,
  action: Hammer,
  status_change: Activity,
};
const KIND_LABELS: Record<IncidentTimelineKind, string> = {
  note: "Note",
  action: "Action",
  status_change: "Status",
};

const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const byTime = (a: TimelineEntryView, b: TimelineEntryView) =>
  new Date(a.at).getTime() - new Date(b.at).getTime();

/**
 * INC-1 timeline in `at` order: add a note or an action at a time you choose (default
 * now), edit or delete your own. Status changes come from the status control and are
 * read-only. Adds and deletes show at once and roll back if the server refuses.
 */
export function IncidentTimeline({
  incidentId,
  entries,
  currentUserId,
}: {
  incidentId: string;
  entries: TimelineEntryView[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(entries);
  const [seen, setSeen] = useState(entries);
  if (seen !== entries) {
    setSeen(entries);
    setItems(entries);
  }
  const [kind, setKind] = useState<"note" | "action">("note");
  const [body, setBody] = useState("");
  const [at, setAt] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const ids = { heading: useId(), kind: useId(), at: useId(), body: useId() };

  function add() {
    const text = body.trim();
    if (!text) return;
    const when = at ? fromLocalInput(at) : null;
    const temp: TimelineEntryView = {
      id: `pending-${Date.now()}`,
      at: when ? new Date(when) : new Date(),
      kind,
      body: text,
      authorId: currentUserId,
      authorName: "You",
    };
    const previous = items;
    setItems([...items, temp].sort(byTime));
    setBody("");
    setAt("");
    startTransition(async () => {
      const result = await callAction(() =>
        addTimelineEntryAction({ incidentId, kind, body: text, ...(when ? { at: when } : {}) }),
      );
      if (result === null) {
        setItems(previous);
        setBody(text);
      } else {
        router.refresh();
      }
    });
  }

  function remove(entry: TimelineEntryView) {
    const previous = items;
    setItems(items.filter((item) => item.id !== entry.id));
    startTransition(async () => {
      const result = await callAction(() => deleteTimelineEntryAction({ entryId: entry.id }));
      if (result === null) setItems(previous);
    });
  }

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-3">
      <h2 id={ids.heading} className="text-sm font-semibold">
        Timeline
      </h2>
      <ol className="flex flex-col gap-0 border-l pl-4">
        {[...items].sort(byTime).map((entry) =>
          editing === entry.id ? (
            <li key={entry.id} className="py-2">
              <EditEntry
                entry={entry}
                onDone={(changed) => {
                  setEditing(null);
                  if (changed) {
                    setItems((current) =>
                      current.map((item) =>
                        item.id === entry.id ? { ...item, ...changed } : item,
                      ),
                    );
                  }
                }}
              />
            </li>
          ) : (
            <TimelineItem
              key={entry.id}
              entry={entry}
              own={entry.authorId === currentUserId && entry.kind !== "status_change"}
              pending={entry.id.startsWith("pending-")}
              onEdit={() => setEditing(entry.id)}
              onDelete={() => remove(entry)}
            />
          ),
        )}
      </ol>
      <form
        className="flex flex-col gap-2 rounded-md border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.kind} className="text-xs text-muted-foreground">
              Type
            </label>
            <Select
              id={ids.kind}
              label="Entry type"
              className="w-28"
              value={kind}
              options={[
                { value: "note", label: "Note" },
                { value: "action", label: "Action" },
              ]}
              onChange={(next) => {
                if (next === "note" || next === "action") setKind(next);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.at} className="text-xs text-muted-foreground">
              At (empty = now)
            </label>
            <Input
              id={ids.at}
              type="datetime-local"
              value={at}
              max={toLocalInput(new Date())}
              onChange={(event) => setAt(event.target.value)}
            />
          </div>
        </div>
        <label htmlFor={ids.body} className="sr-only">
          What happened
        </label>
        <textarea
          id={ids.body}
          rows={2}
          value={body}
          maxLength={INCIDENT_TIMELINE_BODY_MAX}
          placeholder={
            kind === "action"
              ? "What was done, e.g. Rolled back api-v1.4"
              : "What was seen or learned"
          }
          className={textareaClass}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="submit" size="sm" className="self-start" disabled={!body.trim()}>
          Add to timeline
        </Button>
      </form>
    </section>
  );
}

function TimelineItem({
  entry,
  own,
  pending,
  onEdit,
  onDelete,
}: {
  entry: TimelineEntryView;
  own: boolean;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = KIND_ICONS[entry.kind];
  const at = new Date(entry.at);
  return (
    <li className={cn("relative py-2", pending && "opacity-60")}>
      <span className="absolute top-3 -left-[1.4rem] rounded-full bg-background p-0.5">
        <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <time dateTime={at.toISOString()} suppressHydrationWarning>
          {formatDateTime(at)}
        </time>
        <span>{KIND_LABELS[entry.kind]}</span>
        <span>· {entry.authorName ?? "Someone"}</span>
        {own && !pending ? (
          <span className="ml-auto flex gap-1">
            <button
              type="button"
              aria-label="Edit entry"
              onClick={onEdit}
              className="rounded p-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete entry"
              onClick={onDelete}
              className="rounded p-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        ) : null}
      </div>
      <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
    </li>
  );
}

function EditEntry({
  entry,
  onDone,
}: {
  entry: TimelineEntryView;
  onDone: (changed: { body: string; at: Date } | null) => void;
}) {
  const [body, setBody] = useState(entry.body);
  const original = toLocalInput(new Date(entry.at));
  const [at, setAt] = useState(original);
  const [pending, startTransition] = useTransition();
  const ids = { at: useId(), body: useId() };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        // The input holds minutes only: send the time only when it was changed, so fixing
        // a typo never moves the entry.
        const when = at === original ? null : fromLocalInput(at);
        const text = body.trim();
        if ((at !== original && !when) || !text) return;
        startTransition(async () => {
          const result = await callAction(() =>
            editTimelineEntryAction({
              entryId: entry.id,
              body: text,
              ...(when ? { at: when } : {}),
            }),
          );
          onDone(
            result === null ? null : { body: text, at: when ? new Date(when) : new Date(entry.at) },
          );
        });
      }}
    >
      <label htmlFor={ids.at} className="text-xs text-muted-foreground">
        At
      </label>
      <Input
        id={ids.at}
        type="datetime-local"
        value={at}
        onChange={(event) => setAt(event.target.value)}
      />
      <label htmlFor={ids.body} className="sr-only">
        Entry
      </label>
      <textarea
        id={ids.body}
        rows={2}
        autoFocus
        value={body}
        maxLength={INCIDENT_TIMELINE_BODY_MAX}
        className={textareaClass}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone(null);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
