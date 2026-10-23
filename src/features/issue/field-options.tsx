import { type SelectOption } from "@/components/ui/select";
import {
  ISSUE_TYPE_LABELS,
  type IssueType,
  type Priority,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/issues/constants";
import { type IssueSummary, type LabelView, type StatusOption } from "@/lib/issues/views";
import { type ReleaseOption } from "@/lib/releases/views";
import { type SprintOption } from "@/lib/sprints/views";

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

/**
 * BLG-3 sprint picker: the active and planned sprints. An issue still in a closed sprint
 * (a Done issue stays there) shows that as a disabled entry rather than as "Backlog".
 */
export function sprintOptions(
  sprints: SprintOption[],
  currentId: string | null = null,
): SelectOption<string>[] {
  const options = sprints.map((sprint): SelectOption<string> => ({
    value: sprint.id,
    label: sprint.name,
    detail: sprint.state === "active" ? "Active" : undefined,
  }));
  if (currentId && !sprints.some((sprint) => sprint.id === currentId)) {
    options.push({ value: currentId, label: "A closed sprint", disabled: true });
  }
  return options;
}

/**
 * REL-1 "Fix version" picker: unreleased releases first (as `getProjectMeta` orders them),
 * released ones marked so. Assigning a released one is allowed (a late fix to a shipped
 * version), so they stay pickable.
 */
export const releaseOptions = (releases: ReleaseOption[]): SelectOption<string>[] =>
  releases.map((release) => ({
    value: release.id,
    label: release.name,
    detail: release.state === "released" ? "Released" : undefined,
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
