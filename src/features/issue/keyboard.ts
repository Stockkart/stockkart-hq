/**
 * Single-key shortcuts (`C`, SPEC §9.5) must not fire while the user is typing. True for
 * inputs, textareas, selects and rich-text editors (contenteditable).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
