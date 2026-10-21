import { type DiagramKind } from "@/lib/diagrams/constants";
import { flowToSvg } from "@/lib/diagrams/flow-svg";
import { type DiagramScene, flowSceneSchema, whiteboardSceneSchema } from "@/lib/diagrams/scene";

import { toExcalidrawElements } from "./excalidraw-elements";

/**
 * Browser-only rendering of a scene to SVG/PNG for DGM-5 thumbnails and DGM-6 exports.
 * Works from the scene alone (no mounted canvas), so a thumbnail can still be drawn while
 * the editor unmounts. Excalidraw is imported on demand: it only ever loads on diagram
 * pages, and never on the server.
 */

/** Rasterises an SVG document; `maxWidth` scales it down (never up). */
export async function svgToPng(svg: string, maxWidth?: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not render the diagram"));
      image.src = url;
    });
    const scale = maxWidth ? Math.min(1, maxWidth / Math.max(1, image.naturalWidth)) : 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the PNG"))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function whiteboardExport(scene: DiagramScene) {
  const parsed = whiteboardSceneSchema.parse(scene);
  const excalidraw = await import("@excalidraw/excalidraw");
  const elements = excalidraw.getNonDeletedElements(
    excalidraw.restoreElements(toExcalidrawElements(parsed.elements), null, {
      refreshDimensions: true,
      repairBindings: true,
    }),
  );
  const appState = {
    viewBackgroundColor: parsed.appState.viewBackgroundColor ?? "#ffffff",
    exportBackground: true,
    exportWithDarkMode: false,
  };
  return { excalidraw, elements, appState };
}

export async function diagramSvg(kind: DiagramKind, scene: DiagramScene): Promise<string> {
  if (kind === "flow") return flowToSvg(flowSceneSchema.parse(scene));
  const { excalidraw, elements, appState } = await whiteboardExport(scene);
  const svg = await excalidraw.exportToSvg({
    elements,
    appState,
    files: null,
    exportPadding: 24,
    // Fonts are not inlined: fetching them would go to Excalidraw's CDN, which the CSP
    // blocks (and which should not see what we draw). Viewers use their local fallback.
    skipInliningFonts: true,
  });
  return new XMLSerializer().serializeToString(svg);
}

/** PNG of the diagram, at most `maxWidth` wide (thumbnails) or at 2× (downloads). */
export async function diagramPng(
  kind: DiagramKind,
  scene: DiagramScene,
  maxWidth?: number,
): Promise<Blob> {
  if (kind === "flow") return svgToPng(flowToSvg(flowSceneSchema.parse(scene)), maxWidth);
  const { excalidraw, elements, appState } = await whiteboardExport(scene);
  return excalidraw.exportToBlob({
    elements,
    appState,
    files: null,
    mimeType: "image/png",
    exportPadding: 24,
    getDimensions: (width: number, height: number) => {
      const scale = maxWidth ? Math.min(1, maxWidth / Math.max(1, width)) : 2;
      return { width: width * scale, height: height * scale, scale };
    },
  });
}

/** Saves a blob under `filename` (an object URL on a temporary link). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a title: letters, digits and dashes only. */
export function exportFilename(title: string, extension: "png" | "svg"): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "diagram"}.${extension}`;
}
