import { type IssueLinkType, type LinkRelation } from "./constants";

/**
 * ISS-6. A link is stored once, in its active direction (`source blocks target`,
 * `source duplicates target`). Viewed from the target it reads as the inverse ("is blocked
 * by", "is duplicated by"); `relates` reads the same both ways.
 */

export interface StoredLink {
  sourceIssueId: string;
  targetIssueId: string;
  type: IssueLinkType;
}

/** What to store when the user says "<issue> <relation> <other>". */
export function toStoredLink(relation: LinkRelation, issueId: string, otherId: string): StoredLink {
  switch (relation) {
    case "blocks":
      return { sourceIssueId: issueId, targetIssueId: otherId, type: "blocks" };
    case "is_blocked_by":
      return { sourceIssueId: otherId, targetIssueId: issueId, type: "blocks" };
    case "relates":
      return { sourceIssueId: issueId, targetIssueId: otherId, type: "relates" };
    case "duplicates":
      return { sourceIssueId: issueId, targetIssueId: otherId, type: "duplicates" };
    case "is_duplicated_by":
      return { sourceIssueId: otherId, targetIssueId: issueId, type: "duplicates" };
  }
}

/** How `link` reads from `viewpointIssueId`, plus the id of the issue on the other end. */
export function viewLink(
  link: StoredLink,
  viewpointIssueId: string,
): { relation: LinkRelation; otherIssueId: string } {
  const outgoing = link.sourceIssueId === viewpointIssueId;
  const otherIssueId = outgoing ? link.targetIssueId : link.sourceIssueId;
  switch (link.type) {
    case "blocks":
      return { relation: outgoing ? "blocks" : "is_blocked_by", otherIssueId };
    case "duplicates":
      return { relation: outgoing ? "duplicates" : "is_duplicated_by", otherIssueId };
    case "relates":
      return { relation: "relates", otherIssueId };
  }
}

/** Order of relation groups in the Links panel. */
export const LINK_RELATION_ORDER: Record<LinkRelation, number> = {
  blocks: 0,
  is_blocked_by: 1,
  duplicates: 2,
  is_duplicated_by: 3,
  relates: 4,
};
