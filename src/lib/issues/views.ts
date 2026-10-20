import { type RichTextDoc } from "@/lib/rich-text";

import { type IssueType, type LinkRelation, type Priority, type StatusCategory } from "./constants";

/** Read models passed from server components to client components. Plain data only. */

export interface StatusOption {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface NamedOption {
  id: string;
  name: string;
}

export interface UserOption {
  id: string;
  name: string;
  email: string;
}

export interface IssueSummary {
  id: string;
  key: string;
  title: string;
  type: IssueType;
}

export interface IssueListItem extends IssueSummary {
  number: number;
  priority: Priority;
  status: StatusOption;
  assignee: NamedOption | null;
}

/** A row on the issue list, backlog and board (VW-1, BLG-*, BRD-*). */
export interface PlanningIssue extends IssueSummary {
  number: number;
  priority: Priority;
  status: StatusOption;
  assignee: NamedOption | null;
  component: NamedOption | null;
  /** The parent, when it is an epic (BLG-2 "group by epic"). */
  epic: IssueSummary | null;
  storyPoints: number | null;
  labels: LabelView[];
  /** Backlog order (`fractional-indexing` key). */
  rank: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface ChildIssue extends IssueSummary {
  status: StatusOption;
  priority: Priority;
}

export interface LinkView {
  linkId: string;
  relation: LinkRelation;
  issue: ChildIssue;
}

export interface MentionView {
  /** Where the reference was written. */
  sourceKind: "issue" | "comment";
  issue: IssueSummary;
}

export interface LabelView {
  id: string;
  name: string;
  color: string | null;
}

export interface IssueDetail extends IssueSummary {
  number: number;
  projectId: string;
  projectKey: string;
  description: RichTextDoc | null;
  statusId: string;
  priority: Priority;
  assigneeId: string | null;
  reporter: NamedOption | null;
  componentId: string | null;
  parent: IssueSummary | null;
  storyPoints: number | null;
  /** ISO `YYYY-MM-DD`. */
  dueDate: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  labels: LabelView[];
}

export interface ActivityView {
  id: string;
  actorName: string | null;
  action: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ProjectMeta {
  statuses: StatusOption[];
  components: NamedOption[];
  labels: LabelView[];
  users: UserOption[];
  epics: IssueSummary[];
}

export interface CommentView {
  id: string;
  authorId: string | null;
  authorName: string | null;
  body: RichTextDoc;
  createdAt: Date;
  editedAt: Date | null;
}
