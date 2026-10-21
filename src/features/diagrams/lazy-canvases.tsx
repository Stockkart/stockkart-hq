"use client";

import dynamic from "next/dynamic";

/**
 * The canvases load only in the browser and only on the diagram page (SPEC §9.2, risk 4:
 * Excalidraw is large). The placeholder keeps the layout from jumping while they load.
 */
function CanvasLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex size-full items-center justify-center bg-muted/30 text-sm text-muted-foreground"
    >
      Loading the canvas…
    </div>
  );
}

export const LazyWhiteboardCanvas = dynamic(() => import("./whiteboard-canvas"), {
  ssr: false,
  loading: CanvasLoading,
});

export const LazyFlowCanvas = dynamic(() => import("./flow-canvas"), {
  ssr: false,
  loading: CanvasLoading,
});
