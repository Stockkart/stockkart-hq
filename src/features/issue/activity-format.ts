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
  /** Who did it, when not an HQ user (GitHub events have no `actor_id`). */
  actor?: string;
  /** Extra context, e.g. "PR #118 in inventory-api merged by imf-ali". */
  note?: string;
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

/** GH-3 activity: written by the webhook with `actor_id` null and this meta. */
const githubMetaSchema = z.object({
  source: z.literal("github"),
  repo: z.string().optional(),
  pr: z.number().int().nullish(),
  mergedBy: z.string().nullish(),
});

function githubNote(meta: z.infer<typeof githubMetaSchema>): string | undefined {
  if (meta.pr === null || meta.pr === undefined) return undefined;
  const repo = meta.repo?.split("/").at(-1);
  const pr = repo ? `PR #${meta.pr} in ${repo}` : `PR #${meta.pr}`;
  return meta.mergedBy ? `${pr} merged by ${meta.mergedBy}` : `${pr} merged`;
}

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
  const github = githubMetaSchema.safeParse(entry.meta);
  // GitHub only ever writes status changes; anything else from it falls through below.
  if (
    github.success &&
    entry.actorName === null &&
    entry.action === "updated" &&
    entry.field === "status"
  ) {
    return {
      actor: "GitHub",
      verb: "moved this to",
      from: null,
      to: display("status", entry.toValue, lookups) ?? "none",
      note: githubNote(github.data),
    };
  }
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
    case "attachment_added":
      return { verb: "attached", from: null, to: meta.name ?? "a file" };
    case "attachment_removed":
      return { verb: "removed attachment", from: meta.name ?? "a file", to: null };
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
