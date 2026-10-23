import { ADR_STATUS_LABELS } from "@/lib/docs/constants";
import { type DocDetail } from "@/lib/docs/views";
import { cn } from "@/lib/utils";

import { type DocHeaderBadge } from "../doc-actions/types";

/**
 * The doc header's status slot, next to the breadcrumb. To add a badge (e.g. the handbook
 * sync slice's "In sync / Changed in HQ / Changed in the repo"), put a component taking
 * `{ doc }` in a file of its own and add ONE line below. Ids must be unique (checked at
 * load). A badge renders null when it has nothing to show.
 */

/** ADR-2 status, as a quiet pill (superseded ADRs also get the banner). */
function AdrStatusBadge({ doc }: { doc: DocDetail }) {
  if (doc.type !== "adr" || !doc.adrStatus) return null;
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs",
        doc.adrStatus === "superseded" || doc.adrStatus === "deprecated"
          ? "border-amber-500/50 text-amber-700 dark:text-amber-400"
          : "text-muted-foreground",
      )}
    >
      {ADR_STATUS_LABELS[doc.adrStatus]}
    </span>
  );
}

export const DOC_HEADER_BADGES: readonly DocHeaderBadge[] = uniqueById([
  { id: "adr-status", Badge: AdrStatusBadge },
  // A new badge adds one line here.
]);

function uniqueById(badges: DocHeaderBadge[]): readonly DocHeaderBadge[] {
  const ids = new Set<string>();
  for (const badge of badges) {
    if (ids.has(badge.id)) throw new Error(`Doc header badges: "${badge.id}" is registered twice`);
    ids.add(badge.id);
  }
  return badges;
}

export function DocHeaderBadges({
  doc,
  badges = DOC_HEADER_BADGES,
}: {
  doc: DocDetail;
  badges?: readonly DocHeaderBadge[];
}) {
  return (
    <span className="flex items-center gap-1.5" data-slot="doc-header-badges">
      {badges.map(({ id, Badge }) => (
        <Badge key={id} doc={doc} />
      ))}
    </span>
  );
}
