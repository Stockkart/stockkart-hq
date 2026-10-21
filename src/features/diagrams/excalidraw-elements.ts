import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { type WhiteboardElement } from "@/lib/diagrams/scene";

/**
 * The boundary between stored whiteboard JSON and Excalidraw's element type (types only:
 * this module loads no Excalidraw code). The scene schema checked `id` and `type`; every
 * other field is normalised and repaired by Excalidraw's `restoreElements`, which is built
 * for untrusted files and always runs on these before they are drawn or exported.
 */
function isElementShaped(
  element: WhiteboardElement,
): element is WhiteboardElement & ExcalidrawElement {
  return typeof element.id === "string" && typeof element.type === "string";
}

export function toExcalidrawElements(
  elements: readonly WhiteboardElement[],
): readonly ExcalidrawElement[] {
  return elements.filter(isElementShaped);
}
