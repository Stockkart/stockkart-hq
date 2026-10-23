"use client";

import { useId, useState, useTransition } from "react";

import { Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import { DIGEST_FREQUENCIES, type DigestFrequency } from "@/lib/notifications/constants";
import { setDigestFrequencyAction, setNotifyEmailAction } from "@/server/actions/notifications";

const FREQUENCY_LABELS: Record<DigestFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly (Mondays)",
};

/**
 * Settings → Notifications (NTF-2): the email digest opt-in and its cadence. Each change is
 * shown at once and rolled back if the server refuses. While email is not configured on the
 * server (`emailReady` false) the choices are still saved, and a note says no email is sent.
 */
export function NotificationSettings({
  initialNotifyEmail,
  initialFrequency,
  emailReady,
  notConfiguredMessage,
}: {
  initialNotifyEmail: boolean;
  initialFrequency: DigestFrequency;
  emailReady: boolean;
  notConfiguredMessage: string;
}) {
  const [enabled, setEnabled] = useState(initialNotifyEmail);
  const [frequency, setFrequency] = useState(initialFrequency);
  const [pending, startTransition] = useTransition();
  const checkboxId = useId();
  const hintId = useId();
  const frequencyId = useId();

  function change(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await callAction(() => setNotifyEmailAction({ enabled: next }));
      if (result === null) setEnabled(!next);
    });
  }

  function changeFrequency(next: DigestFrequency) {
    const previous = frequency;
    setFrequency(next);
    startTransition(async () => {
      const result = await callAction(() => setDigestFrequencyAction({ frequency: next }));
      if (result === null) setFrequency(previous);
    });
  }

  return (
    <section aria-labelledby={`${checkboxId}-heading`} className="flex flex-col gap-2">
      <h2 id={`${checkboxId}-heading`} className="text-lg font-medium">
        Notifications
      </h2>
      <p className="text-sm text-muted-foreground">
        The bell shows assignments, @mentions, comments on your docs and threads, and comments and
        status changes on issues you watch.
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
            Email me a digest of unread notifications
          </label>
          <p id={hintId} className="text-xs text-muted-foreground">
            Up to 50 unread notifications per email, with links into HQ. Nothing is sent when there
            is nothing new. Every email has a one-click unsubscribe link.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1 pl-6">
        <label htmlFor={frequencyId} className="text-xs text-muted-foreground">
          How often
        </label>
        <Select
          id={frequencyId}
          label="How often"
          className="w-48"
          value={frequency}
          options={DIGEST_FREQUENCIES.map((value) => ({ value, label: FREQUENCY_LABELS[value] }))}
          onChange={(next) => {
            if (next && next !== frequency) changeFrequency(next);
          }}
        />
      </div>
      {emailReady ? null : (
        <p
          role="note"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
        >
          {notConfiguredMessage}
        </p>
      )}
    </section>
  );
}
