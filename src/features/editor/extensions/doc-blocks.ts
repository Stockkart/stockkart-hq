import { TableKit } from "@tiptap/extension-table";
import { type Editor } from "@tiptap/react";
import { Columns3, Info, Rows3, Table, TableCellsSplit, Workflow, X } from "lucide-react";

import { Callout } from "../callout-node";
import { MermaidBlock } from "../mermaid-node";

import { type EditorFeature } from "./types";

/** DOC-1 callouts, tables and DOC-7 Mermaid blocks: doc editors only. */

export const calloutFeature: EditorFeature = {
  name: "callout",
  variants: ["doc"],
  extensions: () => [Callout],
  insertButtons: [
    {
      label: "Callout",
      icon: Info,
      isActive: (e) => e.isActive("callout"),
      run: (e) => e.chain().focus().toggleCallout().run(),
    },
  ],
};

const notInTable = (e: Editor) => !e.isActive("table");

export const tableFeature: EditorFeature = {
  name: "table",
  variants: ["doc"],
  extensions: () => [TableKit.configure({ table: { resizable: false } })],
  insertButtons: [
    {
      label: "Insert table",
      icon: Table,
      isActive: () => false,
      isDisabled: (e) => e.isActive("table"),
      run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
  ],
  toolbarGroups: [
    [
      {
        label: "Add row below",
        icon: Rows3,
        isActive: () => false,
        isDisabled: notInTable,
        run: (e) => e.chain().focus().addRowAfter().run(),
      },
      {
        label: "Add column right",
        icon: Columns3,
        isActive: () => false,
        isDisabled: notInTable,
        run: (e) => e.chain().focus().addColumnAfter().run(),
      },
      {
        label: "Delete row",
        icon: TableCellsSplit,
        isActive: () => false,
        isDisabled: notInTable,
        run: (e) => e.chain().focus().deleteRow().run(),
      },
      {
        label: "Delete table",
        icon: X,
        isActive: () => false,
        isDisabled: notInTable,
        run: (e) => e.chain().focus().deleteTable().run(),
      },
    ],
  ],
};

export const mermaidFeature: EditorFeature = {
  name: "mermaid",
  variants: ["doc"],
  extensions: () => [MermaidBlock],
  insertButtons: [
    {
      label: "Mermaid diagram",
      icon: Workflow,
      isActive: (e) => e.isActive("mermaid"),
      run: (e) => e.chain().focus().insertMermaid().run(),
    },
  ],
};
