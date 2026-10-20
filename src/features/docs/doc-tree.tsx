"use client";

import { ChevronRight, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type DragEvent, useMemo, useState, useTransition } from "react";

import { callAction } from "@/features/issue/client-utils";
import { buildTree, descendantIds, siblingsOf, type TreeNode } from "@/lib/docs/tree";
import { docPath, type DocTreeItem } from "@/lib/docs/views";
import { cn } from "@/lib/utils";
import { moveDocAction } from "@/server/actions/docs";

import { ActionMenu } from "./action-menu";
import { DeleteDocDialog, MoveDocDialog, NewDocDialog, RenameDocDialog } from "./doc-dialogs";

/** Drop zones on a row: the top and bottom quarter insert next to it, the middle nests. */
export type DropZone = "before" | "inside" | "after";

export function dropZoneAt(offsetY: number, height: number): DropZone {
  if (height <= 0) return "inside";
  const ratio = offsetY / height;
  return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
}

/**
 * Where a drop puts the dragged doc: parent and index among that parent's other children,
 * the same shape the "Move to…" dialog sends. Null for an impossible drop (onto itself or
 * one of its descendants; the server refuses those too).
 */
export function dropTarget(
  docs: readonly DocTreeItem[],
  draggedId: string,
  targetId: string,
  zone: DropZone,
): { parentId: string | null; index: number } | null {
  if (draggedId === targetId || descendantIds(docs, draggedId).has(targetId)) return null;
  const target = docs.find((doc) => doc.id === targetId);
  if (!target) return null;
  if (zone === "inside") {
    return { parentId: target.id, index: siblingsOf(docs, target.id, draggedId).length };
  }
  const known = new Set(docs.map((doc) => doc.id));
  const parentId = target.parentId && known.has(target.parentId) ? target.parentId : null;
  const siblings = siblingsOf(docs, parentId, draggedId);
  const at = siblings.findIndex((doc) => doc.id === targetId);
  return { parentId, index: zone === "before" ? at : at + 1 };
}

type DialogState =
  | { kind: "new"; parent: DocTreeItem | null }
  | { kind: "rename" | "move" | "delete"; doc: DocTreeItem }
  | null;

const DRAG_TYPE = "application/x-hq-doc";

/**
 * DOC-2 page tree: expand/collapse, drag to reorder or nest, and a per-row menu (new
 * sub-page, rename, "Move to…" as the keyboard alternative to dragging, delete).
 */
export function DocTree({ projectKey, docs }: { projectKey: string; docs: DocTreeItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const roots = useMemo(() => buildTree(docs), [docs]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; zone: DropZone } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const byId = useMemo(() => new Map(docs.map((doc) => [doc.id, doc])), [docs]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function move(docId: string, target: { parentId: string | null; index: number }) {
    startTransition(async () => {
      const result = await callAction(() => moveDocAction({ docId, ...target }));
      if (result === null) return;
      const parent = target.parentId ? byId.get(target.parentId)?.title : null;
      setAnnouncement(
        `Moved “${byId.get(docId)?.title ?? "page"}” ${parent ? `into “${parent}”` : "to the top level"}`,
      );
      if (target.parentId) {
        // Show where it went.
        setCollapsed((current) => {
          const next = new Set(current);
          next.delete(target.parentId ?? "");
          return next;
        });
      }
      router.refresh();
    });
  }

  function onDragOver(event: DragEvent<HTMLElement>, id: string) {
    if (!dragging) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const zone = dropZoneAt(event.clientY - rect.top, rect.height);
    if (!dropTarget(docs, dragging, id, zone)) return;
    // preventDefault marks this a valid drop target.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (over?.id !== id || over.zone !== zone) setOver({ id, zone });
  }

  function onDrop(event: DragEvent<HTMLElement>, id: string) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData(DRAG_TYPE) || dragging;
    const zone = over?.id === id ? over.zone : "inside";
    setOver(null);
    setDragging(null);
    if (!draggedId) return;
    const target = dropTarget(docs, draggedId, id, zone);
    if (target) move(draggedId, target);
  }

  function renderNode(node: TreeNode<DocTreeItem>, depth: number) {
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && !collapsed.has(node.id);
    const href = docPath(projectKey, node.id);
    const current = pathname === href;
    const zone = over?.id === node.id ? over.zone : null;
    return (
      <li key={node.id}>
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, node.id);
            event.dataTransfer.effectAllowed = "move";
            setDragging(node.id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onDragOver={(event) => onDragOver(event, node.id)}
          onDragLeave={() => setOver((value) => (value?.id === node.id ? null : value))}
          onDrop={(event) => onDrop(event, node.id)}
          data-drop={zone ?? undefined}
          className={cn(
            "group flex items-center gap-0.5 rounded-md pr-1 text-sm hover:bg-sidebar-accent",
            current && "bg-sidebar-accent font-medium",
            dragging === node.id && "opacity-50",
            zone === "inside" && "ring-2 ring-ring",
            zone === "before" && "shadow-[inset_0_2px_0_0_var(--ring)]",
            zone === "after" && "shadow-[inset_0_-2px_0_0_var(--ring)]",
          )}
          style={{ paddingLeft: `${depth * 0.75}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
              aria-expanded={expanded}
              onClick={() => toggle(node.id)}
              className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
          ) : (
            <FileText
              aria-hidden="true"
              className="mx-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          <Link
            href={href}
            aria-current={current ? "page" : undefined}
            className="min-w-0 flex-1 truncate rounded-sm px-1 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {node.title}
          </Link>
          <ActionMenu
            label={`Actions for ${node.title}`}
            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            actions={[
              { label: "New sub-page", onSelect: () => setDialog({ kind: "new", parent: node }) },
              // ADR titles carry their number; they are renamed in the editor.
              ...(node.type === "adr"
                ? []
                : [{ label: "Rename…", onSelect: () => setDialog({ kind: "rename", doc: node }) }]),
              { label: "Move to…", onSelect: () => setDialog({ kind: "move", doc: node }) },
              {
                label: "Delete…",
                destructive: true,
                onSelect: () => setDialog({ kind: "delete", doc: node }),
              },
            ]}
          />
        </div>
        {expanded ? (
          <ul className="flex flex-col">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  const deleting = dialog?.kind === "delete" ? dialog.doc : null;
  const deletingParent = deleting?.parentId ? byId.get(deleting.parentId) : undefined;

  return (
    <nav aria-label="Pages" className="flex flex-col gap-1" aria-busy={pending || undefined}>
      <div className="flex items-center justify-between px-1">
        <Link
          href={`/${projectKey}/docs`}
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          Pages
        </Link>
        <button
          type="button"
          aria-label="New page"
          title="New page"
          onClick={() => setDialog({ kind: "new", parent: null })}
          className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      {roots.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No pages yet.</p>
      ) : (
        <ul className="flex flex-col">{roots.map((node) => renderNode(node, 0))}</ul>
      )}
      {dragging ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData(DRAG_TYPE) || dragging;
            setDragging(null);
            setOver(null);
            move(draggedId, { parentId: null, index: siblingsOf(docs, null, draggedId).length });
          }}
          className="rounded-md border border-dashed px-2 py-1.5 text-center text-xs text-muted-foreground"
        >
          Drop here for the top level
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {dialog?.kind === "new" ? (
        <NewDocDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          projectKey={projectKey}
          parent={dialog.parent}
        />
      ) : null}
      {dialog?.kind === "rename" ? (
        <RenameDocDialog open onOpenChange={(open) => !open && setDialog(null)} doc={dialog.doc} />
      ) : null}
      {dialog?.kind === "move" ? (
        <MoveDocDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          doc={dialog.doc}
          docs={docs}
        />
      ) : null}
      {deleting ? (
        <DeleteDocDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          doc={deleting}
          childCount={docs.filter((doc) => doc.parentId === deleting.id).length}
          parentTitle={deletingParent?.title ?? null}
          afterDelete={
            pathname === docPath(projectKey, deleting.id)
              ? () => router.push(`/${projectKey}/docs`)
              : undefined
          }
        />
      ) : null}
    </nav>
  );
}
