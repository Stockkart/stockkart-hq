import { type DocDetail } from "@/lib/docs/views";
import { statusAtVersion } from "@/lib/handbook/sync-state";

import { HandbookStatusBadge } from "./handbook-status-badge";

/** The status as of the latest version saved on the page (see `statusAtVersion`). */
export function handbookStatusOf(doc: DocDetail) {
  return doc.handbook ? statusAtVersion(doc.handbook, doc.version) : null;
}

/**
 * DOC-14 sync status in the doc header's badges slot (`DOC_HEADER_BADGES`), in read and
 * edit mode. Stored state only (`doc.handbook`, read with the doc); the page passes the
 * latest version saved on it, so an autosave turns "In sync" into "Changed in HQ" at once.
 * Nothing for docs that are not handbook files (the importer's group pages).
 */
export function HandbookHeaderBadge({ doc }: { doc: DocDetail }) {
  const sync = doc.handbook;
  const status = handbookStatusOf(doc);
  if (!sync || !status) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="sr-only">Handbook ({sync.path}): </span>
      <HandbookStatusBadge status={status} pr={sync.pr} />
    </span>
  );
}
