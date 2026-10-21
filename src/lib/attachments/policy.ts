import { MAX_ATTACHMENT_BYTES } from "./constants";

/**
 * Content-type policy for uploads and downloads (ISS-9, S-5, S-8). Isomorphic and pure: the
 * upload UI uses it to explain what will happen, the server uses it to decide the stored
 * Content-Type and the download disposition. `presignDownload` applies it again, so a caller
 * cannot ask for an unsafe combination.
 *
 * Files are served from the R2 origin, not from HQ. Anything a browser could run there
 * (SVG, HTML, XML, JavaScript) is stored and served as `application/octet-stream` with
 * `Content-Disposition: attachment`, so it downloads instead of executing. The client's mime
 * type and file name are untrusted input: either one looking "active" is enough.
 */

export type UploadCategory = "image" | "pdf" | "text" | "active" | "other";
export type Disposition = "inline" | "attachment";

export interface UploadClass {
  category: UploadCategory;
  /** The Content-Type to store and serve. */
  contentType: string;
  /** Whether `inline` may be served at all; when false, downloads are always `attachment`. */
  inlineAllowed: boolean;
  /** The disposition to use when the caller has no preference. */
  defaultDisposition: Disposition;
}

export const OCTET_STREAM = "application/octet-stream";

// Maps, not object literals, so a type such as "constructor" never matches a prototype key.

/** Inline-viewable images and their extensions. SVG is deliberately absent: it can carry script. */
const IMAGE_TYPES = new Map<string, readonly string[]>([
  ["image/png", ["png"]],
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/webp", ["webp"]],
  ["image/gif", ["gif"]],
]);

/** Types and extensions a browser may render as a document that runs script. */
const ACTIVE_TYPE_PATTERN =
  /(^text\/html$)|(^application\/xhtml\+xml$)|(^image\/svg\+xml$)|(xml$)|(javascript)|(ecmascript)|(^text\/xsl$)|(^multipart\/related$)|(^message\/rfc822$)/;
const ACTIVE_EXTENSIONS = new Set([
  "svg",
  "svgz",
  "html",
  "htm",
  "shtml",
  "xhtml",
  "xht",
  "xml",
  "xsl",
  "xslt",
  "mht",
  "mhtml",
  "js",
  "mjs",
  "cjs",
]);

/** Plain-text attachments and the Content-Type they are served with. */
const TEXT_TYPES = new Map<string, string>([
  ["text/plain", "text/plain; charset=utf-8"],
  ["text/csv", "text/csv; charset=utf-8"],
  ["application/json", "application/json"],
]);
/** Browsers often send no type (or octet-stream) for `.log`; the extension decides then. */
const TEXT_EXTENSIONS = new Map<string, string>([
  ["txt", "text/plain; charset=utf-8"],
  ["log", "text/plain; charset=utf-8"],
  ["csv", "text/csv; charset=utf-8"],
  ["json", "application/json"],
]);

/** `image/PNG; charset=x` → `image/png`. */
export function normalizeMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

/** Lower-case extension of the last path segment, without the dot; "" when there is none. */
export function fileExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function classifyUpload(mime: string, filename: string): UploadClass {
  const type = normalizeMime(mime);
  const extension = fileExtension(filename);

  // Checked first: an "image/png" named `x.svg`, or `x.png` claiming text/html, is active.
  if (ACTIVE_TYPE_PATTERN.test(type) || ACTIVE_EXTENSIONS.has(extension)) {
    return {
      category: "active",
      contentType: OCTET_STREAM,
      inlineAllowed: false,
      defaultDisposition: "attachment",
    };
  }
  if (IMAGE_TYPES.has(type)) {
    return {
      category: "image",
      contentType: type,
      inlineAllowed: true,
      defaultDisposition: "inline",
    };
  }
  if (type === "application/pdf") {
    // PDFs open in the browser's sandboxed viewer when asked for inline; download otherwise.
    return {
      category: "pdf",
      contentType: type,
      inlineAllowed: true,
      defaultDisposition: "attachment",
    };
  }
  const textType =
    TEXT_TYPES.get(type) ??
    (type === "" || type === OCTET_STREAM ? TEXT_EXTENSIONS.get(extension) : undefined);
  if (textType) {
    return {
      category: "text",
      contentType: textType,
      inlineAllowed: false,
      defaultDisposition: "attachment",
    };
  }
  return {
    category: "other",
    contentType: OCTET_STREAM,
    inlineAllowed: false,
    defaultDisposition: "attachment",
  };
}

/** The disposition actually served: `inline` only when the policy allows it. */
export function effectiveDisposition(upload: UploadClass, requested?: Disposition): Disposition {
  const wanted = requested ?? upload.defaultDisposition;
  return wanted === "inline" && upload.inlineAllowed ? "inline" : "attachment";
}

/** 1 byte … 10 MB (`MAX_ATTACHMENT_BYTES`), whole numbers only. */
export function isAllowedUploadSize(sizeBytes: number): boolean {
  return Number.isSafeInteger(sizeBytes) && sizeBytes >= 1 && sizeBytes <= MAX_ATTACHMENT_BYTES;
}

/** Whether an image's extension matches its type (`IMAGE_TYPES`); UIs may warn otherwise. */
export function imageExtensionMatches(mime: string, filename: string): boolean {
  return IMAGE_TYPES.get(normalizeMime(mime))?.includes(fileExtension(filename)) ?? false;
}
