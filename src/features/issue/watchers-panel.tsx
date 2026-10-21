"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { type UserOption } from "@/lib/issues/views";
import { setWatchingAction } from "@/server/actions/watchers";

import { callAction } from "./client-utils";
import { Avatar } from "./issue-badges";

/** Avatars shown before "+N". */
const SHOWN = 8;

/**
 * ISS-11 watchers in the issue side panel: Watch / Unwatch for the signed-in user (shown at
 * once, rolled back if the server refuses), the count and the watchers' avatars. Watchers
 * hear about comments and status changes (NTF-1).
 */
export function WatchersPanel({
  issueId,
  watchers,
  currentUser,
}: {
  issueId: string;
  watchers: UserOption[];
  currentUser: UserOption;
}) {
  const headingId = useId();
  const [list, setList] = useState(watchers);
  // Follow the server's list after a refresh (adjusting state during render).
  const [seen, setSeen] = useState(watchers);
  if (seen !== watchers) {
    setSeen(watchers);
    setList(watchers);
  }
  const [pending, startTransition] = useTransition();
  const watching = list.some((user) => user.id === currentUser.id);

  function toggle() {
    const before = list;
    const next = !watching;
    setList(next ? [...before, currentUser] : before.filter((user) => user.id !== currentUser.id));
    startTransition(async () => {
      const result = await callAction(() => setWatchingAction({ issueId, watching: next }));
      if (result === null) setList(before);
    });
  }

  const count = list.length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="font-medium">
          Watchers <span className="text-muted-foreground">({count})</span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-pressed={watching}
          disabled={pending}
          onClick={toggle}
        >
          {watching ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {watching ? "Unwatch" : "Watch"}
        </Button>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody is watching this issue.</p>
      ) : (
        <ul className="flex flex-wrap items-center gap-1" aria-label="People watching">
          {list.slice(0, SHOWN).map((user) => (
            <li key={user.id} title={user.name}>
              <Avatar name={user.name} className="size-6" />
              <span className="sr-only">{user.name}</span>
            </li>
          ))}
          {count > SHOWN ? (
            <li className="text-xs text-muted-foreground">
              +{count - SHOWN}
              <span className="sr-only">
                {" "}
                more:{" "}
                {list
                  .slice(SHOWN)
                  .map((user) => user.name)
                  .join(", ")}
              </span>
            </li>
          ) : null}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {watching ? "You are watching this issue." : "You are not watching this issue."}
      </p>
    </section>
  );
}
