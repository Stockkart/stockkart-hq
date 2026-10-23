"use client";

import { useMemo } from "react";

import { lineDiff } from "@/lib/text/line-diff";

import { LineDiffView } from "../diff/line-diff-view";

/**
 * DOC-10 unified diff of two Markdown exports (`lineDiff`), drawn by the shared
 * `LineDiffView` (the handbook publish and pull dialogs use it too).
 */

export { diffSummary } from "../diff/line-diff-view";

export function VersionDiff({
  oldText,
  newText,
  oldLabel,
  newLabel,
}: {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}) {
  const hunks = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  return <LineDiffView hunks={hunks} oldLabel={oldLabel} newLabel={newLabel} />;
}
