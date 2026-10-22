"use client";

import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { richTextDocSchema, type RichTextDoc } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

import {
  type EditorVariant,
  featureExtensions,
  featureToolbarGroups,
  type ToolbarButton,
  type ToolbarContext,
} from "./extensions";
import { IssueRefHighlight } from "./issue-ref-highlight";
import { isSafeHref } from "./safe-href";

/**
 * The shared rich-text editor (DOC-1 subset for issues and comments). Built on Tiptap's MIT
 * packages. Content is ProseMirror JSON (`RichTextDoc`); the editor never emits or accepts
 * HTML.
 *
 * The core (marks, headings, lists, quotes, code blocks, links, `STK-123` chips, shortcuts)
 * lives here. Further node types and behaviours are features in `extensions/` (callouts,
 * tables and Mermaid blocks for `variant="doc"`, DOC-1, DOC-7), registered once in
 * `extensions/index.ts`: add a node there, not here. Issues and comments keep the smaller
 * basic toolbar.
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
  /**
   * Which registered features load (`extensions/index.ts`); `doc` also gets the doc toolbar
   * (DOC-1). Fixed for the editor's lifetime. Defaults to `issue`.
   */
  variant?: EditorVariant;
}

const MARK_BUTTONS: ToolbarButton[] = [
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
];

const HEADING_3: ToolbarButton = {
  label: "Heading",
  icon: Heading3,
  isActive: (e) => e.isActive("heading", { level: 3 }),
  run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
};

const BLOCK_BUTTONS: ToolbarButton[] = [
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
];

const BASIC_TOOLBAR: ToolbarButton[][] = [MARK_BUTTONS, [HEADING_3, ...BLOCK_BUTTONS]];

/** The doc editor's core groups; registered features add theirs after these. */
const DOC_TOOLBAR: ToolbarButton[][] = [
  [
    ...MARK_BUTTONS,
    {
      label: "Link",
      icon: LinkIcon,
      isActive: (e) => e.isActive("link"),
      run: (_e, context) => context.openLink(),
    },
  ],
  [
    {
      label: "Heading 1",
      icon: Heading1,
      isActive: (e) => e.isActive("heading", { level: 1 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      icon: Heading2,
      isActive: (e) => e.isActive("heading", { level: 2 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    { ...HEADING_3, label: "Heading 3" },
    ...BLOCK_BUTTONS,
  ],
];

/** Position of each button in Tab/arrow order, by [group][index]. */
function positionsOf(groups: ToolbarButton[][]): number[][] {
  return groups.map((group, groupIndex) =>
    group.map(
      (_, index) =>
        groups.slice(0, groupIndex).reduce((sum, previous) => sum + previous.length, 0) + index,
    ),
  );
}

interface ToolbarLayout {
  groups: ToolbarButton[][];
  positions: number[][];
}

/** A variant's toolbar: its core groups plus the registered features' groups. */
function toolbarFor(variant: EditorVariant): ToolbarLayout {
  const groups = [
    ...(variant === "doc" ? DOC_TOOLBAR : BASIC_TOOLBAR),
    ...featureToolbarGroups(variant),
  ];
  return { groups, positions: positionsOf(groups) };
}

const TOOLBARS: Record<EditorVariant, ToolbarLayout> = {
  issue: toolbarFor("issue"),
  comment: toolbarFor("comment"),
  doc: toolbarFor("doc"),
};

function Toolbar({
  editor,
  groups,
  positions,
  context,
}: {
  editor: Editor;
  groups: ToolbarButton[][];
  positions: number[][];
  context: ToolbarContext;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }): Record<string, { active: boolean; disabled: boolean }> =>
      Object.fromEntries(
        groups.flat().map((button) => [
          button.label,
          {
            active: current ? button.isActive(current) : false,
            disabled: current ? (button.isDisabled?.(current) ?? false) : false,
          },
        ]),
      ),
  });
  // ARIA toolbar pattern: one Tab stop; arrow keys, Home and End move between buttons.
  const [focusIndex, setFocusIndex] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const count = groups.flat().length;
  const moveFocus = (index: number) => {
    const next = (index + count) % count;
    setFocusIndex(next);
    buttons.current[next]?.focus();
  };
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1"
      onKeyDown={(event) => {
        const keys: Record<string, number> = {
          ArrowRight: focusIndex + 1,
          ArrowLeft: focusIndex - 1,
          Home: 0,
          End: count - 1,
        };
        const target = keys[event.key];
        if (target === undefined) return;
        event.preventDefault();
        moveFocus(target);
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className={cn("flex items-center gap-0.5", groupIndex > 0 && "border-l pl-1")}
        >
          {group.map((button, buttonIndex) => {
            const position = positions[groupIndex]?.[buttonIndex] ?? 0;
            const pressed = state?.[button.label]?.active ?? false;
            const disabled = state?.[button.label]?.disabled ?? false;
            const Icon = button.icon;
            return (
              <button
                key={button.label}
                ref={(element) => {
                  buttons.current[position] = element;
                }}
                type="button"
                tabIndex={position === focusIndex ? 0 : -1}
                aria-label={button.label}
                aria-pressed={pressed}
                // aria-disabled (not disabled) keeps the button in the arrow-key order.
                aria-disabled={disabled || undefined}
                title={button.label}
                // Keep the selection: a mousedown on the button would otherwise blur the editor.
                onMouseDown={(event) => event.preventDefault()}
                onFocus={() => setFocusIndex(position)}
                onClick={() => {
                  if (!disabled) button.run(editor, context);
                }}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  pressed && "bg-accent text-accent-foreground",
                  disabled && "opacity-40 hover:bg-transparent",
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

/** Link editing (doc variant): URL field below the toolbar; only safe schemes are applied. */
function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const inputId = useId();
  const [href, setHref] = useState(() => {
    const current: unknown = editor.getAttributes("link").href;
    return typeof current === "string" ? current : "";
  });
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const value = href.trim();
    if (value === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      onClose();
      return;
    }
    // Same rule as the renderer and the editor's link extension (S-8).
    if (!isSafeHref(value)) {
      setError("Use an http(s) or mailto link");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    onClose();
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        Link URL
      </label>
      <input
        id={inputId}
        autoFocus
        value={href}
        placeholder="https://"
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(event) => {
          setHref(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="h-7 min-w-48 flex-1 rounded border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <button type="submit" className="rounded px-2 py-1 text-xs font-medium hover:bg-accent">
        Apply
      </button>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs hover:bg-accent"
        onClick={() => {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          onClose();
        }}
      >
        Remove link
      </button>
      <span id={`${inputId}-error`} aria-live="polite" className="text-xs text-destructive">
        {error}
      </span>
    </form>
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
  variant = "issue",
}: RichTextEditorProps) {
  // Callbacks change on every render; the editor is created once, so read them via refs.
  const callbacks = useRef({ onChange, onSubmit, onCancel });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onCancel };
  });
  const [linkOpen, setLinkOpen] = useState(false);
  // The variant is fixed when the editor is created (extensions cannot change later).
  const [fixedVariant] = useState(variant);
  const toolbar = TOOLBARS[fixedVariant];

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
      // Registered features for this variant (extensions/index.ts).
      ...featureExtensions({ variant: fixedVariant, projectKeys }),
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

  const context: ToolbarContext = { openLink: () => setLinkOpen(true) };

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
    >
      {editor ? (
        <Toolbar
          editor={editor}
          groups={toolbar.groups}
          positions={toolbar.positions}
          context={context}
        />
      ) : null}
      {editor && linkOpen ? <LinkForm editor={editor} onClose={() => setLinkOpen(false)} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
