/**
 * Single-key shortcuts (`C`, SPEC §9.5) must not fire while the user is typing. True for
 * inputs, textareas, selects, rich-text editors (contenteditable) and our pickers
 * (`role="combobox"`, where letters are type-ahead). Checkboxes and radios take no text, so
 * `x` on a focused row checkbox still toggles it (ISS-12).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.getAttribute("role") === "combobox") return true;
  if (target instanceof HTMLInputElement) {
    return target.type !== "checkbox" && target.type !== "radio";
  }
  const tag = target.tagName;
  return tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The guard for every single-key shortcut (`C`, `J`, `K`, SPEC §9.5): ignore the key when it
 * comes with a modifier (so browser and OS shortcuts keep working), when something already
 * handled it, during IME composition, while typing, or while a dialog or menu is open (its
 * own keys win there).
 */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return true;
  if (event.isComposing) return true;
  if (isTypingTarget(event.target)) return true;
  if (event.target instanceof Element) {
    if (event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return true;
  }
  return false;
}
