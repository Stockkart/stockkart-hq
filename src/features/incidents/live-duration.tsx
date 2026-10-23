"use client";

import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/incidents/rules";

/**
 * INC-1 duration: start → resolution, or start → now while open (re-rendered every 30 s,
 * the display is in minutes). Server and browser clocks may differ, hence the warning
 * suppression; the next tick corrects it.
 */
export function LiveDuration({
  startedAt,
  resolvedAt,
}: {
  startedAt: Date | string;
  resolvedAt: Date | string | null;
}) {
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [end]);
  const text = formatDuration((end ?? now) - start);
  return (
    <span suppressHydrationWarning title={end === null ? "Still open" : undefined}>
      {text}
      {end === null ? <span className="sr-only"> so far</span> : null}
    </span>
  );
}
