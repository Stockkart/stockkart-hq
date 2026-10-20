"use client";

import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { richTextDocSchema, type RichTextDoc } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

import { IssueRefHighlight } from "./issue-ref-highlight";
import { isSafeHref } from "./safe-href";

/**
 * The shared rich-text editor (DOC-1 subset for issues and comments). Built on Tiptap's MIT
 * packages; docs (Phase 1 slice 3) extend it with more node types such as Mermaid blocks by
 * adding extensions here. Content is ProseMirror JSON (`RichTextDoc`); the editor never
 * emits or accepts HTML.
 *
 * Client-only: load it through `LazyRichTextEditor` (next/dynamic, ssr: false).
 */

export interface RichTextEditorProps {
  /** Initial content; remount (change `key`) to replace it. */
  initialContent: RichTextDoc | null;
  onChange: (doc: RichTextDoc) => void;
  /** Mod+Enter, e.g. submit a comment. */
  onSubmit?: () => void;
  /** Escape, e.g. cancel an edit. */
  onCancel?: () => void;
  /** Project keys whose `KEY-123` references are highlighted as chips. */
  projectKeys: string[];
  /** Accessible name of the editing area. */
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

interface ToolbarButton {
  label: string;
  icon: LucideIcon;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const TOOLBAR: ToolbarButton[][] = [
  [
    {
      label: "Bold",
      icon: Bold,
      isActive: (e) => e.isActive("bold"),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      isActive: (e) => e.isActive("italic"),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      label: "Strikethrough",
      icon: Strikethrough,
      isActive: (e) => e.isActive("strike"),
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    {
      label: "Inline code",
      icon: Code,
      isActive: (e) => e.isActive("code"),
      run: (e) => e.chain().focus().toggleCode().run(),
    },
  ],
  [
    {
      label: "Heading",
      icon: Heading3,
      isActive: (e) => e.isActive("heading", { level: 3 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "Bulleted list",
      icon: List,
      isActive: (e) => e.isActive("bulletList"),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      isActive: (e) => e.isActive("orderedList"),
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Checklist",
      icon: ListChecks,
      isActive: (e) => e.isActive("taskList"),
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Quote",
      icon: Quote,
      isActive: (e) => e.isActive("blockquote"),
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Code block",
      icon: SquareCode,
      isActive: (e) => e.isActive("codeBlock"),
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
  ],
];

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }): Record<string, boolean> =>
      Object.fromEntries(
        TOOLBAR.flat().map((button) => [button.label, current ? button.isActive(current) : false]),
      ),
  });
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1"
    >
      {TOOLBAR.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className={cn("flex items-center gap-0.5", groupIndex > 0 && "border-l pl-1")}
        >
          {group.map((button) => {
            const pressed = active?.[button.label] ?? false;
            const Icon = button.icon;
            return (
              <button
                key={button.label}
                type="button"
                aria-label={button.label}
                aria-pressed={pressed}
                title={button.label}
                // Keep the selection: a mousedown on the button would otherwise blur the editor.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => button.run(editor)}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  pressed && "bg-accent text-accent-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function RichTextEditor({
  initialContent,
  onChange,
  onSubmit,
  onCancel,
  projectKeys,
  label,
  placeholder = "Write something…",
  autoFocus = false,
  className,
}: RichTextEditorProps) {
  // Callbacks change on every render; the editor is created once, so read them via refs.
  const callbacks = useRef({ onChange, onSubmit, onCancel });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onCancel };
  });

  const editor = useEditor({
    // Rendered only on the client (next/dynamic, ssr: false); this avoids a hydration pass.
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
          // Same rule as the renderer: no javascript:, data: or other schemes.
          isAllowedUri: (url) => isSafeHref(url),
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      IssueRefHighlight.configure({ projectKeys }),
      Extension.create({
        name: "editorShortcuts",
        addKeyboardShortcuts() {
          return {
            "Mod-Enter": () => {
              callbacks.current.onSubmit?.();
              return Boolean(callbacks.current.onSubmit);
            },
            Escape: () => {
              callbacks.current.onCancel?.();
              return Boolean(callbacks.current.onCancel);
            },
          };
        },
      }),
    ],
    content: initialContent ?? undefined,
    editorProps: {
      attributes: {
        class: "rich-text min-h-24 px-3 py-2 outline-none",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: current }) => {
      // Editor JSON is validated with the same schema the server uses.
      const parsed = richTextDocSchema.safeParse(current.getJSON());
      if (parsed.success) callbacks.current.onChange(parsed.data);
    },
  });

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
    >
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
