import { z } from "zod";

import {
  LINK_RELATION_LABELS,
  LINK_RELATIONS,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/issues/constants";
import { type ActivityView } from "@/lib/issues/views";

/** Turns ISS-8 activity rows (raw ids and values) into readable sentences. Isomorphic. */

export interface ActivityLookups {
  statuses: Map<string, string>;
  users: Map<string, string>;
  components: Map<string, string>;
  /** Open sprints by id; a closed or deleted sprint shows as "an earlier sprint". */
  sprints?: Map<string, string>;
  issueKeys: Record<string, string>;
}

export interface ActivitySentence {
  /** E.g. "changed status", "added label". */
  verb: string;
  from: string | null;
  to: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  title: "the title",
  description: "the description",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  component: "component",
  storyPoints: "story points",
  dueDate: "due date",
  parent: "parent",
  sprint: "sprint",
};

const metaSchema = z
  .object({ name: z.string().optional(), relation: z.enum(LINK_RELATIONS).optional() })
  .catch({});

function display(field: string | null, value: string | null, lookups: ActivityLookups) {
  if (value === null) return null;
  switch (field) {
    case "status":
      return lookups.statuses.get(value) ?? "a deleted status";
    case "assignee":
      return lookups.users.get(value) ?? "a former user";
    case "component":
      return lookups.components.get(value) ?? "a deleted component";
    case "parent":
      return lookups.issueKeys[value] ?? "a deleted issue";
    case "sprint":
      return lookups.sprints?.get(value) ?? "an earlier sprint";
    case "priority": {
      const priority = PRIORITIES.find((p) => String(p) === value);
      return priority === undefined ? value : PRIORITY_LABELS[priority];
    }
    default:
      return value;
  }
}

export function describeActivity(entry: ActivityView, lookups: ActivityLookups): ActivitySentence {
  const meta = metaSchema.parse(entry.meta ?? {});
  switch (entry.action) {
    case "created":
      return { verb: "created the issue", from: null, to: null };
    case "deleted":
      return { verb: "deleted the issue", from: null, to: null };
    case "label_added":
      return { verb: "added label", from: null, to: meta.name ?? null };
    case "label_removed":
      return { verb: "removed label", from: meta.name ?? null, to: null };
    case "link_added":
    case "link_removed": {
      const other = entry.action === "link_added" ? entry.toValue : entry.fromValue;
      const key = other ? (lookups.issueKeys[other] ?? "a deleted issue") : "an issue";
      const relation = meta.relation ? LINK_RELATION_LABELS[meta.relation] : "linked to";
      const verb = entry.action === "link_added" ? "added link" : "removed link";
      return { verb, from: null, to: `${relation} ${key}` };
    }
    case "updated": {
      const field = entry.field ?? "";
      const label = FIELD_LABELS[field] ?? field;
      if (field === "description") return { verb: "updated the description", from: null, to: null };
      return {
        verb: `changed ${label}`,
        from: display(field, entry.fromValue, lookups) ?? "none",
        to: display(field, entry.toValue, lookups) ?? "none",
      };
    }
    default:
      return { verb: entry.action.replace(/_/g, " "), from: null, to: null };
  }
}
