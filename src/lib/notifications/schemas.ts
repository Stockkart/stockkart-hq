import { z } from "zod";

/** Inputs of the notification, watcher and settings actions (NTF-1, NTF-2, ISS-11). */

export const notificationIdInput = z.object({ notificationId: z.uuid() });

export const notifyEmailInput = z.object({ enabled: z.boolean() });

export const watchIssueInput = z.object({ issueId: z.uuid(), watching: z.boolean() });

/** The /notifications page number (1-based), from the URL; anything odd is page 1. */
export const notificationsPageParam = z.coerce.number().int().min(1).max(10_000).catch(1);

/** Rows per /notifications page, and in the bell popover. */
export const NOTIFICATIONS_PAGE_SIZE = 30;
export const BELL_LATEST = 20;
/** MY-1 "Mentions": the latest mentions shown on My Work. */
export const MY_WORK_MENTIONS = 10;
