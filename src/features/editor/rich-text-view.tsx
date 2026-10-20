import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { issuePath, splitIssueRefs } from "@/lib/issues/keys";
import { type RichTextMark, type RichTextNode } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

import { isSafeHref } from "./safe-href";

/**
 * Read-only rendering of stored rich text as React elements (S-8): no HTML string is ever
 * produced or injected, unknown node types render only their children, and links keep only
 * http(s)/mailto targets. `STK-123` in text becomes a chip linking to the issue (ISS-7).
 *
 * Works in server and client components.
 */

export interface RichTextViewProps {
  doc: RichTextNode | null;
  projectKeys: readonly string[];
  className?: string;
  /** Shown when the document has no content. */
  empty?: ReactNode;
}

function textWithRefs(text: string, projectKeys: readonly string[]): ReactNode {
  const segments = splitIssueRefs(text, projectKeys);
  if (segments.length === 1 && segments[0]?.kind === "text") return text;
  return segments.map((segment, index) =>
    segment.kind === "text" ? (
      <Fragment key={index}>{segment.text}</Fragment>
    ) : (
      <Link
        key={index}
        href={issuePath(segment.ref.projectKey, segment.ref.number)}
        className="issue-ref-chip"
      >
        {segment.text}
      </Link>
    ),
  );
}

function applyMark(mark: RichTextMark, child: ReactNode, key: number): ReactNode {
  switch (mark.type) {
    case "bold":
      return <strong key={key}>{child}</strong>;
    case "italic":
      return <em key={key}>{child}</em>;
    case "strike":
      return <s key={key}>{child}</s>;
    case "underline":
      return <u key={key}>{child}</u>;
    case "code":
      return <code key={key}>{child}</code>;
    case "link": {
      const href = mark.attrs?.href;
      if (!isSafeHref(href)) return child;
      return (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
          {child}
        </a>
      );
    }
    default:
      return child;
  }
}

function headingLevel(attrs: Record<string, unknown> | undefined): 1 | 2 | 3 {
  const level = attrs?.level;
  return level === 1 || level === 2 ? level : 3;
}

function renderNode(
  node: RichTextNode,
  key: number,
  projectKeys: readonly string[],
  inCode = false,
): ReactNode {
  if (node.type === "text") {
    const marks = node.marks ?? [];
    const isCode = inCode || marks.some((mark) => mark.type === "code");
    let content: ReactNode = isCode
      ? (node.text ?? "")
      : textWithRefs(node.text ?? "", projectKeys);
    marks.forEach((mark, index) => {
      content = applyMark(mark, content, index);
    });
    return <Fragment key={key}>{content}</Fragment>;
  }

  const children = (node.content ?? []).map((child, index) =>
    renderNode(child, index, projectKeys, inCode || node.type === "codeBlock"),
  );

  switch (node.type) {
    case "doc":
      return <Fragment key={key}>{children}</Fragment>;
    case "paragraph":
      return <p key={key}>{children}</p>;
    case "heading": {
      // The page title is the h1, so stored levels 1–3 render as h2–h4.
      const level = headingLevel(node.attrs);
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      return <Tag key={key}>{children}</Tag>;
    }
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList": {
      const start = node.attrs?.start;
      return (
        <ol key={key} start={typeof start === "number" ? start : undefined}>
          {children}
        </ol>
      );
    }
    case "listItem":
      return <li key={key}>{children}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList">
          {children}
        </ul>
      );
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      return (
        <li key={key} data-type="taskItem" data-checked={checked}>
          <input type="checkbox" checked={checked} readOnly disabled aria-label="Done" />
          <div>{children}</div>
        </li>
      );
    }
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "hardBreak":
      return <br key={key} />;
    default:
      return <Fragment key={key}>{children}</Fragment>;
  }
}

export function RichTextView({ doc, projectKeys, className, empty = null }: RichTextViewProps) {
  const hasContent = (doc?.content ?? []).some(
    (node) => node.type !== "paragraph" || (node.content?.length ?? 0) > 0,
  );
  if (!doc || !hasContent) return <>{empty}</>;
  return <div className={cn("rich-text", className)}>{renderNode(doc, 0, projectKeys)}</div>;
}
