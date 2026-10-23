"use client";

import { useState } from "react";

import { ActionMenu } from "../action-menu";

import { DOC_ACTIONS, visibleDocActions } from "./index";
import { type DocAction, type DocActionContext } from "./types";

/** The doc header's "⋯" menu, built from `DOC_ACTIONS` (see `index.ts`). */
export function DocActionsMenu({
  context,
  actions = DOC_ACTIONS,
}: {
  context: DocActionContext;
  /** Tests pass their own registry. */
  actions?: readonly DocAction[];
}) {
  const [open, setOpen] = useState<DocAction | null>(null);
  const items = visibleDocActions(context, actions);
  const Dialog = open?.dialog;
  return (
    <>
      <ActionMenu
        label={`More actions for ${context.doc.title}`}
        actions={items.map(({ action, label }) => ({
          label,
          destructive: action.destructive,
          onSelect: () => {
            if (action.dialog) setOpen(action);
            else void action.run?.(context);
          },
        }))}
      />
      {Dialog ? (
        <Dialog context={context} open onOpenChange={(next) => !next && setOpen(null)} />
      ) : null}
    </>
  );
}
