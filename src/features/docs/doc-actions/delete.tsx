"use client";

import { useRouter } from "next/navigation";

import { DeleteDocDialog } from "../doc-dialogs";

import { type DocAction, type DocActionDialogProps } from "./types";

/** DOC-2 delete from the doc page; its sub-pages move up (see `deleteDoc`). */
function DeleteDialog({ context, open, onOpenChange }: DocActionDialogProps) {
  const router = useRouter();
  return (
    <DeleteDocDialog
      open={open}
      onOpenChange={onOpenChange}
      doc={context.doc}
      childCount={context.childCount}
      parentTitle={context.ancestors.at(-1)?.title ?? null}
      afterDelete={() => router.push(`/${context.doc.projectKey}/docs`)}
    />
  );
}

export const deleteAction: DocAction = {
  id: "delete",
  label: "Delete…",
  destructive: true,
  dialog: DeleteDialog,
};
