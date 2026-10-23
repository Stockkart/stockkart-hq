import { notificationActor, notificationHref, notificationText } from "@/lib/notifications/format";
import { type NotificationView } from "@/lib/notifications/views";

import { escapeHtml } from "./html";

/**
 * NTF-2 digest email: a plain-text and a simple HTML part with the same content. Every
 * value from users or the database (names, issue and doc titles) is HTML-escaped in the
 * HTML part; links are APP_BASE_URL plus a path the app built itself.
 */

/** At most this many items per email; the rest is "and N more". */
export const DIGEST_MAX_ITEMS = 50;

export interface DigestContent {
  subject: string;
  text: string;
  html: string;
}

/** An absolute link for an app path, or null when it is not a plain same-origin path. */
export function appLink(baseUrl: string, path: string | null): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return null;
  }
  return `${baseUrl}${path}`;
}

export function buildDigestEmail(input: {
  items: readonly NotificationView[];
  /** All unread notifications in the period (≥ items.length). */
  total: number;
  baseUrl: string;
  unsubscribeUrl: string;
}): DigestContent {
  const { items, total, baseUrl, unsubscribeUrl } = input;
  const more = Math.max(0, total - items.length);
  const allLink = `${baseUrl}/notifications`;
  const settingsLink = `${baseUrl}/settings/profile`;
  const lines = items.map((item) => ({
    text: `${notificationActor(item)} ${notificationText(item)}`,
    href: appLink(baseUrl, notificationHref(item)),
  }));
  const noun = total === 1 ? "notification" : "notifications";
  const subject = `Stockkart HQ: ${total} unread ${noun}`;

  const text = [
    `You have ${total} unread ${noun} in Stockkart HQ:`,
    "",
    ...lines.flatMap((line) => [`- ${line.text}`, ...(line.href ? [`  ${line.href}`] : [])]),
    ...(more > 0 ? ["", `…and ${more} more: ${allLink}`] : []),
    "",
    "--",
    `Change how often you get this email: ${settingsLink}`,
    `Unsubscribe: ${unsubscribeUrl}`,
    "",
  ].join("\n");

  const item = (line: { text: string; href: string | null }) =>
    line.href
      ? `<li style="margin:0 0 8px"><a href="${escapeHtml(line.href)}">${escapeHtml(line.text)}</a></li>`
      : `<li style="margin:0 0 8px">${escapeHtml(line.text)}</li>`;
  const html = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Stockkart HQ digest</title></head>',
    '<body style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">',
    `<p>You have ${total} unread ${noun} in Stockkart HQ:</p>`,
    `<ul style="padding-left:20px">${lines.map(item).join("")}</ul>`,
    more > 0 ? `<p><a href="${escapeHtml(allLink)}">…and ${more} more</a></p>` : "",
    '<hr style="border:none;border-top:1px solid #ddd">',
    '<p style="font-size:12px;color:#555">',
    `<a href="${escapeHtml(settingsLink)}">Change how often you get this email</a> · `,
    `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>`,
    "</p>",
    "</body></html>",
  ].join("");

  return { subject, text, html };
}
