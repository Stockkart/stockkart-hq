"use client";

import "@excalidraw/excalidraw/index.css";

import {
  CaptureUpdateAction,
  Excalidraw,
  hashElementsVersion,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  toWhiteboardScene,
  WHITEBOARD_IMAGES_DISABLED_MESSAGE,
  type WhiteboardScene,
} from "@/lib/diagrams/scene";

import { useResolvedTheme } from "@/features/theme/use-resolved-theme";

import { toExcalidrawElements } from "./excalidraw-elements";

export interface WhiteboardCanvasProps {
  scene: WhiteboardScene;
  onChange?: (scene: WhiteboardScene) => void;
  readOnly?: boolean;
  /** An element link to an app path (`/STK/issues/STK-1`) opens in the app (DGM-7). */
  onNavigate: (path: string) => void;
}

/** Same-origin app paths only (`/x…`, not `//host`); everything else opens as Excalidraw does. */
function appPath(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * DGM-1 whiteboard (Excalidraw, client-only; loaded with `next/dynamic` on the diagram page
 * only). Stores elements plus `viewBackgroundColor`/`gridSize`; selection, zoom, scroll and
 * the rest of the app state stay in the browser. Images are disabled for now (no R2 key
 * layout for diagram files): the tool is hidden, and pasted or dropped images are removed.
 */
export default function WhiteboardCanvas({
  scene,
  onChange,
  readOnly = false,
  onNavigate,
}: WhiteboardCanvasProps) {
  // The canvas follows the app theme live (DGM-1). Exports stay light (render.ts).
  const theme = useResolvedTheme();
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  // Read once: the editor remounts this canvas (new key) to load another scene.
  const [initialData] = useState(() => ({
    elements: restoreElements(toExcalidrawElements(scene.elements), null, {
      refreshDimensions: true,
      repairBindings: true,
    }),
    appState: {
      ...(scene.appState.viewBackgroundColor
        ? { viewBackgroundColor: scene.appState.viewBackgroundColor }
        : {}),
      // A stored grid size means the grid is on (null or absent: off).
      ...(scene.appState.gridSize
        ? { gridSize: scene.appState.gridSize, gridModeEnabled: true }
        : {}),
    },
    scrollToContent: true,
  }));
  const last = useRef<string | null>(null);

  function handleChange(elements: readonly OrderedExcalidrawElement[], appState: AppState) {
    if (readOnly || !onChange) return;
    // Excalidraw reports every pointer move and selection; only real edits count.
    const grid = appState.gridModeEnabled ? appState.gridSize : null;
    const signature = `${hashElementsVersion(elements)}|${appState.viewBackgroundColor}|${grid}`;
    if (signature === last.current) return;
    const first = last.current === null;
    last.current = signature;
    if (elements.some((element) => element.type === "image" && !element.isDeleted)) {
      api.current?.updateScene({
        elements: elements.filter((element) => element.type !== "image"),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      toast.error(WHITEBOARD_IMAGES_DISABLED_MESSAGE);
      return;
    }
    // The first call is Excalidraw loading the initial scene, not an edit.
    if (first) return;
    onChange(
      toWhiteboardScene(elements, {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: grid,
      }),
    );
  }

  return (
    <div className="size-full" aria-label="Whiteboard canvas">
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={(instance) => {
          api.current = instance;
        }}
        onChange={handleChange}
        viewModeEnabled={readOnly}
        theme={theme}
        autoFocus={!readOnly}
        UIOptions={{
          tools: { image: false },
          canvasActions: {
            // The app saves, exports and themes; Excalidraw's own file actions would bypass it.
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: false,
            toggleTheme: null,
          },
        }}
        onPaste={(data, event) => {
          const pastedFiles = Array.from(event?.clipboardData?.files ?? []);
          const hasImage =
            Object.keys(data.files ?? {}).length > 0 ||
            pastedFiles.some((file) => file.type.startsWith("image/"));
          if (!hasImage) return true;
          toast.error(WHITEBOARD_IMAGES_DISABLED_MESSAGE);
          return false;
        }}
        onLinkOpen={(element, event) => {
          const path = appPath(element.link);
          if (!path) return;
          event.preventDefault();
          onNavigate(path);
        }}
      />
    </div>
  );
}
