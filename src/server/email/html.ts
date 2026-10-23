/**
 * HTML escaping for the email and the unsubscribe page (NTF-2). Everything that comes from a
 * user or the database (titles, names, tokens) goes through `escapeHtml` before it is put
 * into markup, in text and in attribute values alike (both are double-quoted).
 */

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}
