import { type HandbookConfigView, type HandbookDocSync } from "@/lib/handbook/views";

import { HandbookActions } from "./handbook-actions";
import { HandbookStatusBadge } from "./handbook-status-badge";

/**
 * DOC-14 on the current doc page: the status badge and the two actions in one strip. A
 * temporary mount until the docs-UX slice's header badges slot and "⋯" actions registry
 * exist (AGENTS.md "Handbook slice notes"); then the badge and `HandbookActions` move there
 * and this strip goes away.
 */
export function HandbookDocBar({
  projectKey,
  sync,
  config,
}: {
  projectKey: string;
  sync: HandbookDocSync | null;
  config: HandbookConfigView;
}) {
  if (!sync) return null;
  return (
    <section
      aria-label="Engineering handbook"
      className="mb-4 flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="text-muted-foreground">Handbook</span>
      <HandbookStatusBadge status={sync.status} pr={sync.pr} />
      <code className="truncate text-xs text-muted-foreground">{sync.path}</code>
      <span className="ml-auto flex items-center gap-2">
        <HandbookActions projectKey={projectKey} sync={sync} configured={config.configured} />
      </span>
    </section>
  );
}
