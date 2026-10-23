import {
  pullFromHandbookAction,
  publishToHandbookAction,
} from "../handbook-sync/handbook-doc-actions";

import { deleteAction } from "./delete";
import { copyMarkdownAction, downloadMarkdownAction } from "./export-actions";
import { openSuccessorAction, supersedeAction } from "./supersede";
import { type DocAction, type DocActionContext } from "./types";

/**
 * The doc header's "⋯" menu, in order. To add an action (e.g. the handbook sync slice's
 * "Publish to handbook" / "Pull from handbook"), put its descriptor in a file of its own
 * (see `types.ts`: `run` or a `dialog`, optional `visible`) and add ONE line below, above
 * the delete line. Ids must be unique; a duplicate throws at load (and so in every test).
 */
export const DOC_ACTIONS: readonly DocAction[] = uniqueById([
  downloadMarkdownAction,
  copyMarkdownAction,
  supersedeAction,
  openSuccessorAction,
  publishToHandbookAction,
  pullFromHandbookAction,
  // A new action adds one line here.
  deleteAction,
]);

function uniqueById(actions: DocAction[]): readonly DocAction[] {
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.id)) throw new Error(`Doc actions: "${action.id}" is registered twice`);
    seen.add(action.id);
  }
  return actions;
}

/** The actions to show for this doc, with their labels resolved. */
export function visibleDocActions(
  context: DocActionContext,
  actions: readonly DocAction[] = DOC_ACTIONS,
): { action: DocAction; label: string; disabledReason: string | null }[] {
  return actions
    .filter((action) => action.visible?.(context) ?? true)
    .map((action) => ({
      action,
      label: typeof action.label === "function" ? action.label(context) : action.label,
      disabledReason: action.disabledReason?.(context) ?? null,
    }));
}

export { type DocAction, type DocActionContext, type DocActionDialogProps } from "./types";
