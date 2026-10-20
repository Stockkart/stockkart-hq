import { type SelectOption } from "@/components/ui/select";
import {
  ISSUE_TYPE_LABELS,
  type IssueType,
  type Priority,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/issues/constants";
import { type IssueSummary, type LabelView, type StatusOption } from "@/lib/issues/views";

import { Avatar, IssueTypeGlyph, PriorityGlyph, StatusGlyph } from "./issue-badges";

/**
 * Picker options for issue fields, with their icons (status category, priority, type,
 * avatar, label colour). Shared by the side panel, quick create, the backlog and the
 * filter bar so a value looks the same everywhere.
 */

export const statusOptions = (statuses: StatusOption[]): SelectOption<string>[] =>
  statuses.map((status) => ({
    value: status.id,
    label: status.name,
    icon: <StatusGlyph category={status.category} />,
  }));

/** `short`: "P1" labels (the full name stays as the searchable keyword and detail). */
export const priorityOptions = ({ short = false } = {}): SelectOption<Priority>[] =>
  PRIORITIES.map((priority) => ({
    value: priority,
    label: short ? `P${priority}` : PRIORITY_LABELS[priority],
    keywords: PRIORITY_LABELS[priority],
    detail: short ? PRIORITY_LABELS[priority].replace(/^P\d\s*/, "") : undefined,
    icon: <PriorityGlyph priority={priority} />,
  }));

export const typeOptions = (types: readonly IssueType[]): SelectOption<IssueType>[] =>
  types.map((type) => ({
    value: type,
    label: ISSUE_TYPE_LABELS[type],
    icon: <IssueTypeGlyph type={type} />,
  }));

export const userOptions = (users: { id: string; name: string; email?: string }[]) =>
  users.map((user): SelectOption<string> => ({
    value: user.id,
    label: user.name,
    keywords: user.email,
    icon: <Avatar name={user.name} className="size-5" />,
  }));

export const issueOptions = (issues: IssueSummary[]): SelectOption<string>[] =>
  issues.map((issue) => ({
    value: issue.id,
    label: `${issue.key} ${issue.title}`,
    keywords: issue.key,
    icon: <IssueTypeGlyph type={issue.type} />,
  }));

/** A label's colour as a dot (grey when it has none). */
export function LabelDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-full border border-black/10 bg-muted-foreground/40"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export const labelOptions = (labels: LabelView[]): SelectOption<string>[] =>
  labels.map((label) => ({
    value: label.id,
    label: label.name,
    icon: <LabelDot color={label.color} />,
  }));
