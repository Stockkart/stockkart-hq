"use client";

import { useId, useOptimistic, useState, useTransition } from "react";

import { callAction } from "@/features/issue/client-utils";
import { setAutoRetroAction } from "@/server/actions/settings";

/**
 * SPR-5 (General tab): when on, completing a sprint makes its retro doc from the built-in
 * template under "Retros". Saves at once; optimistic, rolled back if the server refuses.
 */
export function AutoRetroToggle({
  projectKey,
  autoRetro,
}: {
  projectKey: string;
  autoRetro: boolean;
}) {
  const [shown, setShown] = useOptimistic(autoRetro);
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const id = useId();
  const hintId = useId();

  function toggle(next: boolean) {
    startTransition(async () => {
      setShown(next);
      const ok =
        (await callAction(() => setAutoRetroAction({ projectKey, autoRetro: next }))) !== null;
      setAnnouncement(
        ok
          ? next
            ? "Retro docs will be created when sprints complete"
            : "Retro docs will not be created automatically"
          : "That change was not saved",
      );
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-1.5 border-t pt-4">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={shown}
          aria-describedby={hintId}
          className="size-4 accent-primary"
          onChange={(event) => toggle(event.target.checked)}
        />
        <label htmlFor={id} className="text-sm font-medium">
          Create a retro doc when a sprint is completed
        </label>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        From the built-in retro template, under the “Retros” page, with the sprint’s goal, dates,
        completed and carried-over issues.
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
