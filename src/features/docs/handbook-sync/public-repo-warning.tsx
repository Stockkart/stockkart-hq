import { HANDBOOK_PUBLIC_WARNING } from "@/lib/handbook/constants";

/**
 * The publish dialog's public-repo warning. Diffs in the publish and pull dialogs are drawn
 * by the shared `LineDiffView` (`features/docs/diff/`), the version history's renderer.
 */
export function PublicRepoWarning() {
  return (
    <p
      role="note"
      className="rounded-md border border-amber-600/40 bg-amber-500/10 p-2 text-sm text-amber-900 dark:text-amber-200"
    >
      <strong>Public repo.</strong> {HANDBOOK_PUBLIC_WARNING}
    </p>
  );
}
