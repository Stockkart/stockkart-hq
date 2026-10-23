import { type NotificationType } from "./constants";

/** Read models of the bell, the notifications page and My Work → Mentions (NTF-1, MY-1). */

/** What a notification points at, resolved when it is read (names and titles stay current). */
export type NotificationTarget =
  | { kind: "issue"; key: string; title: string; href: string }
  | { kind: "doc"; title: string; href: string }
  | { kind: "incident"; key: string; title: string; href: string };

export interface NotificationView {
  id: string;
  type: NotificationType;
  /** Null for system events and for a deleted user. */
  actorName: string | null;
  /** A GitHub-driven change (GH-3): there is no HQ actor, the bell says "GitHub". */
  fromGithub: boolean;
  /** Null when the issue, doc or incident was deleted since. */
  target: NotificationTarget | null;
  /** Status names of a `status_on_watched` move (null when unknown). */
  statusFrom: string | null;
  statusTo: string | null;
  /** Set when the event happened in a comment (mention or new comment). */
  commentId: string | null;
  read: boolean;
  createdAt: Date;
}

export interface NotificationPage {
  items: NotificationView[];
  /** 1-based. */
  page: number;
  hasMore: boolean;
  /** When the list was read; "mark all read" stops there. */
  asOf: Date;
}

/** The bell popover's payload (loaded when it opens). */
export interface BellData {
  items: NotificationView[];
  unread: number;
  /** When the list was read; "mark all read" stops there. */
  asOf: Date;
}

/** An HQ user offered by the @mention suggestion list. */
export interface MentionUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** MY-1 "Mentions": where someone mentioned me. */
export interface MentionItem {
  /** The entity_links row. */
  id: string;
  /** Where the mention is: an issue description, a comment (on `target`), or a doc. */
  source: "issue" | "comment" | "doc";
  target: NotificationTarget;
  mentionedByName: string | null;
  mentionedAt: Date;
}

/** Shown on the unread badge; larger counts read "99+". */
export const UNREAD_BADGE_MAX = 99;
