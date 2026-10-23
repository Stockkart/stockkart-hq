import { type HandbookConfigView, type HandbookDocSync } from "@/lib/handbook/views";
import { handbookConfigView } from "@/server/handbook";
import { handbookQueries } from "@/server/services";
import { type IdRef } from "@/server/services/sql";

/**
 * Server-side loader for the doc page's batched read (README "Performance"): the doc's
 * stored sync state is ONE query, started synchronously so it joins the page's batch; the
 * configuration comes from env. GitHub is never called here.
 */
export function loadHandbookDocSync(
  projectId: IdRef,
  docId: string,
): Promise<{ sync: HandbookDocSync | null; config: HandbookConfigView }> {
  const sync = handbookQueries.docSync(projectId, docId);
  return sync.then((value) => ({ sync: value, config: handbookConfigView() }));
}
