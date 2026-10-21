"use client";

import { useId, useState, useTransition } from "react";

import { callAction } from "@/features/issue/client-utils";
import { setNotifyEmailAction } from "@/server/actions/notifications";

/**
 * Settings → Notifications (NTF-2): the email digest opt-in. Only the choice is stored;
 * delivery is not built yet, hence "coming soon". Shown at once, rolled back on failure.
 */
export function NotificationSettings({ initialNotifyEmail }: { initialNotifyEmail: boolean }) {
  const [enabled, setEnabled] = useState(initialNotifyEmail);
  const [pending, startTransition] = useTransition();
  const checkboxId = useId();
  const hintId = useId();

  function change(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await callAction(() => setNotifyEmailAction({ enabled: next }));
      if (result === null) setEnabled(!next);
    });
  }

  return (
    <section aria-labelledby={`${checkboxId}-heading`} className="flex flex-col gap-2">
      <h2 id={`${checkboxId}-heading`} className="text-lg font-medium">
        Notifications
      </h2>
      <p className="text-sm text-muted-foreground">
        The bell shows assignments, @mentions, and comments and status changes on issues you watch.
      </p>
      <div className="flex items-start gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={enabled}
          disabled={pending}
          aria-describedby={hintId}
          onChange={(event) => change(event.target.checked)}
        />
        <div className="flex flex-col gap-0.5">
          <label htmlFor={checkboxId} className="text-sm font-medium">
            Email me a digest{" "}
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-normal text-secondary-foreground">
              Coming soon
            </span>
          </label>
          <p id={hintId} className="text-xs text-muted-foreground">
            We save your choice now; digest emails are not sent yet.
          </p>
        </div>
      </div>
    </section>
  );
}
