import { describe, expect, it } from "vitest";

import { MAX_ATTACHMENT_BYTES } from "./constants";
import {
  classifyUpload,
  effectiveDisposition,
  imageExtensionMatches,
  isAllowedUploadSize,
} from "./policy";

describe("classifyUpload (ISS-9, S-8)", () => {
  it.each([
    ["image/png", "a.png"],
    ["image/jpeg", "a.jpg"],
    ["IMAGE/WEBP", "a.webp"],
    ["image/gif; foo=bar", "a.gif"],
  ])("shows %s inline", (mime, filename) => {
    expect(classifyUpload(mime, filename)).toMatchObject({
      category: "image",
      inlineAllowed: true,
      defaultDisposition: "inline",
    });
  });

  it.each([
    ["image/svg+xml", "logo.svg"],
    ["image/png", "logo.svg"],
    ["text/html", "page.png"],
    ["text/html", "page.html"],
    ["application/xhtml+xml", "x.xhtml"],
    ["application/xml", "feed.xml"],
    ["text/javascript", "app.js"],
    ["", "page.HTM"],
  ])("never serves active content (%s, %s) inline or with its own type", (mime, filename) => {
    const upload = classifyUpload(mime, filename);
    expect(upload).toEqual({
      category: "active",
      contentType: "application/octet-stream",
      inlineAllowed: false,
      defaultDisposition: "attachment",
    });
    expect(effectiveDisposition(upload, "inline")).toBe("attachment");
  });

  it("downloads PDFs by default but allows them inline", () => {
    const pdf = classifyUpload("application/pdf", "spec.pdf");
    expect(pdf).toMatchObject({ category: "pdf", contentType: "application/pdf" });
    expect(effectiveDisposition(pdf)).toBe("attachment");
    expect(effectiveDisposition(pdf, "inline")).toBe("inline");
  });

  it.each([
    ["text/plain", "notes.txt", "text/plain; charset=utf-8"],
    ["", "server.log", "text/plain; charset=utf-8"],
    ["application/octet-stream", "out.log", "text/plain; charset=utf-8"],
    ["text/csv", "rows.csv", "text/csv; charset=utf-8"],
    ["application/json", "payload.json", "application/json"],
  ])("treats %s %s as a text attachment", (mime, filename, contentType) => {
    const upload = classifyUpload(mime, filename);
    expect(upload).toMatchObject({ category: "text", contentType, inlineAllowed: false });
    expect(effectiveDisposition(upload, "inline")).toBe("attachment");
  });

  it.each([
    ["application/zip", "a.zip"],
    ["application/x-msdownload", "a.exe"],
    ["constructor", "a"],
    ["", "noextension"],
  ])("downloads anything else (%s) as octet-stream", (mime, filename) => {
    expect(classifyUpload(mime, filename)).toEqual({
      category: "other",
      contentType: "application/octet-stream",
      inlineAllowed: false,
      defaultDisposition: "attachment",
    });
  });

  it("is idempotent on its own output type", () => {
    for (const [mime, name] of [
      ["image/png", "a.png"],
      ["text/plain", "a.log"],
      ["image/svg+xml", "a.svg"],
      ["application/pdf", "a.pdf"],
    ] as const) {
      const first = classifyUpload(mime, name);
      expect(classifyUpload(first.contentType, name).contentType).toBe(first.contentType);
    }
  });
});

describe("upload size", () => {
  it("allows 1 byte to 10 MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(isAllowedUploadSize(1)).toBe(true);
    expect(isAllowedUploadSize(MAX_ATTACHMENT_BYTES)).toBe(true);
    expect(isAllowedUploadSize(0)).toBe(false);
    expect(isAllowedUploadSize(MAX_ATTACHMENT_BYTES + 1)).toBe(false);
    expect(isAllowedUploadSize(Number.NaN)).toBe(false);
  });

  it("knows when an image's extension matches", () => {
    expect(imageExtensionMatches("image/jpeg", "a.JPEG")).toBe(true);
    expect(imageExtensionMatches("image/png", "a.jpg")).toBe(false);
  });
});
