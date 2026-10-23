import {
  DEFAULT_PRIORITY,
  ISSUE_TYPE_LABELS,
  ISSUE_TYPES,
  type IssueType,
  type Priority,
  PRIORITIES,
} from "@/lib/issues/constants";
import { labelNameSchema, TITLE_MAX } from "@/lib/issues/schemas";

import { IMPORT_DESCRIPTION_MAX, IMPORT_QUOTE_MAX } from "./constants";
import { type ImportField } from "./fields";

/**
 * IMP-4 row validation: turns the mapped CSV cells into issue values, or per-cell errors.
 * Pure and isomorphic; the server runs it against the project's statuses and the HQ users
 * at preview time and again at apply time (the project may have changed in between).
 */

export interface ImportLookups {
  statuses: readonly { id: string; name: string }[];
  users: readonly { id: string; name: string; email: string }[];
}

/** One valid row, ready for the insert. */
export interface ImportIssueValues {
  title: string;
  type: IssueType;
  priority: Priority;
  /** Null: the type's default status (Triage for bugs, Backlog otherwise; §4.4). */
  statusId: string | null;
  /** Undefined: the project's default assignee (PRJ-3), as quick create without one. */
  assigneeId: string | undefined;
  /** Label names as stored (lower case, dashes); missing ones are created. */
  labels: string[];
  storyPoints: number | null;
  dueDate: string | null;
  description: string | null;
}

export interface ImportCellError {
  field: ImportField;
  message: string;
}

export interface ImportRowResult {
  /** The row number as a spreadsheet shows it: the header is row 1. */
  row: number;
  errors: ImportCellError[];
  values: ImportIssueValues | null;
}

/** A cell value quoted in a message, cut short (the report never stores whole cells). */
export function quote(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return `“${flat.length > IMPORT_QUOTE_MAX ? `${flat.slice(0, IMPORT_QUOTE_MAX)}…` : flat}”`;
}

const typeKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const TYPE_BY_KEY = new Map<string, IssueType>(
  ISSUE_TYPES.flatMap((type) => [
    [type, type],
    [typeKey(ISSUE_TYPE_LABELS[type]), type],
  ]),
);
TYPE_BY_KEY.set("techdebt", "tech_debt");

/** `P0`–`P3` or `0`–`3`, case-insensitive. */
const PRIORITY_PATTERN = /^p?([0-3])$/i;

/** A real calendar date `YYYY-MM-DD` (no 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function byName<T extends { name: string }>(items: readonly T[], value: string): T[] {
  const needle = value.trim().toLowerCase();
  return items.filter((item) => item.name.trim().toLowerCase() === needle);
}

export function validateImportRows(
  fields: readonly ImportField[],
  rows: readonly (readonly string[])[],
  lookups: ImportLookups,
): ImportRowResult[] {
  return rows.map((cells, index) => {
    const errors: ImportCellError[] = [];
    const cell = (field: ImportField) => {
      const at = fields.indexOf(field);
      return at < 0 ? "" : (cells[at] ?? "").trim();
    };
    const fail = (field: ImportField, message: string) => errors.push({ field, message });

    const title = cell("title").replace(/\s+/g, " ");
    if (!title) fail("title", "Title is required");
    else if (title.length > TITLE_MAX)
      fail("title", `Title is longer than ${TITLE_MAX} characters`);

    let type: IssueType = "task";
    const rawType = cell("type");
    if (rawType) {
      const found = TYPE_BY_KEY.get(typeKey(rawType));
      if (!found) fail("type", `Unknown type ${quote(rawType)}`);
      // ISS-3: a subtask needs a parent, which a CSV row cannot name.
      else if (found === "subtask") fail("type", "Subtasks need a parent; import them as tasks");
      else type = found;
    }

    let priority: Priority = DEFAULT_PRIORITY;
    const rawPriority = cell("priority");
    if (rawPriority) {
      const match = PRIORITY_PATTERN.exec(rawPriority);
      const found = PRIORITIES.find((value) => String(value) === match?.[1]);
      if (found !== undefined) priority = found;
      else fail("priority", `Unknown priority ${quote(rawPriority)}; use P0–P3 or 0–3`);
    }

    let statusId: string | null = null;
    const rawStatus = cell("status");
    if (rawStatus) {
      const [status] = byName(lookups.statuses, rawStatus);
      if (status) statusId = status.id;
      else fail("status", `Unknown status ${quote(rawStatus)}`);
    }

    let assigneeId: string | undefined;
    const rawAssignee = cell("assignee");
    if (rawAssignee) {
      const email = rawAssignee.toLowerCase();
      const byEmail = lookups.users.filter((user) => user.email.toLowerCase() === email);
      const matches = byEmail.length > 0 ? byEmail : byName(lookups.users, rawAssignee);
      const [user] = matches;
      if (!user) fail("assignee", `Unknown assignee ${quote(rawAssignee)}`);
      else if (matches.length > 1) {
        fail("assignee", `${quote(rawAssignee)} matches several users; use the email`);
      } else assigneeId = user.id;
    }

    const labels: string[] = [];
    for (const raw of cell("labels").split(";")) {
      if (!raw.trim()) continue;
      const parsed = labelNameSchema.safeParse(raw);
      if (!parsed.success) {
        fail("labels", `Label ${quote(raw)}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      } else if (!labels.includes(parsed.data)) labels.push(parsed.data);
    }

    let storyPoints: number | null = null;
    const rawPoints = cell("points");
    if (rawPoints) {
      const points = /^\d+$/.test(rawPoints) ? Number(rawPoints) : Number.NaN;
      if (!Number.isInteger(points) || points > 999) {
        fail("points", `Points must be a whole number 0–999, not ${quote(rawPoints)}`);
      } else storyPoints = points;
    }

    let dueDate: string | null = null;
    const rawDue = cell("due_date");
    if (rawDue) {
      if (isIsoDate(rawDue)) dueDate = rawDue;
      else fail("due_date", `Due date must be YYYY-MM-DD, not ${quote(rawDue)}`);
    }

    const description = cell("description") || null;
    if (description && description.length > IMPORT_DESCRIPTION_MAX) {
      fail("description", `Description is longer than ${IMPORT_DESCRIPTION_MAX} characters`);
    }

    return {
      row: index + 2,
      errors,
      values:
        errors.length > 0
          ? null
          : {
              title,
              type,
              priority,
              statusId,
              assigneeId,
              labels,
              storyPoints,
              dueDate,
              description,
            },
    };
  });
}
