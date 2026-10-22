/**
 * Client-side image preparation before upload (ISS-9). Screenshots are often 4–8 MB PNGs;
 * downscaling to `MAX_IMAGE_EDGE` on the long edge and re-encoding as WebP usually brings
 * them under 1 MB. Uses only the browser's canvas (createImageBitmap + OffscreenCanvas, with
 * a <canvas> fallback): no extra dependency.
 *
 * The decisions are pure functions (`planImage`, `chooseEncoding`) so they can be tested
 * without a canvas; `prepareImage` does the browser work and never throws: whatever goes
 * wrong, the original file is uploaded as it is.
 */

export const MAX_IMAGE_EDGE = 2560;
export const WEBP_QUALITY = 0.85;

/** Types we may re-encode. GIFs stay as they are (animation), so do unknown types. */
const RESIZABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

export type ImagePlan =
  { kind: "keep" } | { kind: "encode"; width: number; height: number; resized: boolean };

/** What to do with an image of this type and size. */
export function planImage(input: {
  mime: string;
  width: number;
  height: number;
  maxEdge?: number;
}): ImagePlan {
  const maxEdge = input.maxEdge ?? MAX_IMAGE_EDGE;
  const { width, height } = input;
  if (!RESIZABLE.has(input.mime.toLowerCase())) return { kind: "keep" };
  if (!(width > 0 && height > 0)) return { kind: "keep" };
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { kind: "encode", width, height, resized: false };
  const scale = maxEdge / longEdge;
  return {
    kind: "encode",
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

/**
 * Which file to upload. Not resized: WebP only when it is smaller than the original. Resized:
 * the original is too large to keep, so the smaller of WebP and the same format at the new
 * size (or WebP alone when the browser could not encode the same format).
 */
export function chooseEncoding(input: {
  resized: boolean;
  originalBytes: number;
  webpBytes: number | null;
  sameFormatBytes: number | null;
}): "original" | "webp" | "sameFormat" {
  const { resized, originalBytes, webpBytes, sameFormatBytes } = input;
  if (!resized) return webpBytes !== null && webpBytes < originalBytes ? "webp" : "original";
  if (webpBytes !== null && (sameFormatBytes === null || webpBytes <= sameFormatBytes)) {
    return "webp";
  }
  return sameFormatBytes !== null ? "sameFormat" : "original";
}

/** `shot.png` → `shot.webp`. */
export function withExtension(filename: string, extension: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${extension}`;
}

export interface PreparedFile {
  file: File;
  width?: number;
  height?: number;
}

async function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
): Promise<Blob | null> {
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type, quality: WEBP_QUALITY });
      // Browsers that cannot encode `type` silently return PNG instead.
      return blob.type === type ? blob : null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, WEBP_QUALITY),
    );
    return blob && blob.type === type ? blob : null;
  } catch {
    return null;
  }
}

/** Downscales and re-encodes PNG/JPEG/WebP when that helps; records width and height. */
export async function prepareImage(file: File): Promise<PreparedFile> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") {
    return { file };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file };
  }
  try {
    const original = { width: bitmap.width, height: bitmap.height };
    const plan = planImage({ mime: file.type, ...original });
    if (plan.kind === "keep") return { file, ...original };
    const webp = await encode(bitmap, plan.width, plan.height, "image/webp");
    const sameFormat =
      plan.resized && file.type !== "image/webp"
        ? await encode(bitmap, plan.width, plan.height, file.type)
        : null;
    const choice = chooseEncoding({
      resized: plan.resized,
      originalBytes: file.size,
      webpBytes: webp?.size ?? null,
      sameFormatBytes: sameFormat?.size ?? null,
    });
    const dimensions = { width: plan.width, height: plan.height };
    if (choice === "webp" && webp) {
      const name = withExtension(file.name || "image", "webp");
      return { file: new File([webp], name, { type: "image/webp" }), ...dimensions };
    }
    if (choice === "sameFormat" && sameFormat) {
      return { file: new File([sameFormat], file.name, { type: file.type }), ...dimensions };
    }
    return { file, ...original };
  } finally {
    bitmap.close();
  }
}
