import { describe, expect, it } from "vitest";

import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";

import {
  attachmentIdsIn,
  attachmentUrl,
  fileNodeAttrs,
  hasPendingUploads,
  imageNodeAttrs,
  withoutPendingUploads,
} from "./nodes";
import { formatBytes } from "./views";

const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-9999-aaaaaaaaaaaa";

const doc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Before" }] },
    {
      type: "image",
      attrs: { attachmentId: A, alt: "Login screen STK-7", width: 800, height: 600 },
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Log: " },
        { type: "fileAttachment", attrs: { attachmentId: B, filename: "server.log", size: 2048 } },
      ],
    },
    { type: "image", attrs: { attachmentId: A.toUpperCase(), alt: "again" } },
  ],
};

describe("attachment node attrs (ISS-9)", () => {
  it("validates image attrs and drops one-sided dimensions", () => {
    expect(imageNodeAttrs({ attachmentId: A, alt: "x", width: 10, height: 20 })).toEqual({
      attachmentId: A,
      alt: "x",
      width: 10,
      height: 20,
    });
    expect(imageNodeAttrs({ attachmentId: A, width: 10 })).toEqual({
      attachmentId: A,
      alt: "",
      width: null,
      height: null,
    });
    expect(imageNodeAttrs({ attachmentId: A, width: -1, height: 1.5 })).toMatchObject({
      width: null,
      height: null,
    });
  });

  it("refuses ids that are not uuids (no path or URL ever reaches a src)", () => {
    for (const attachmentId of [
      "../backups/x",
      "https://evil.test/x.png",
      `${A}?download=1`,
      42,
      null,
    ]) {
      expect(imageNodeAttrs({ attachmentId })).toBeNull();
      expect(fileNodeAttrs({ attachmentId })).toBeNull();
    }
  });

  it("validates file attrs", () => {
    expect(fileNodeAttrs({ attachmentId: B, filename: "a.log", size: 3 })).toEqual({
      attachmentId: B,
      filename: "a.log",
      size: 3,
    });
    expect(fileNodeAttrs({ attachmentId: B, filename: " ", size: "3" })).toEqual({
      attachmentId: B,
      filename: "file",
      size: null,
    });
  });

  it("builds only the authed route", () => {
    expect(attachmentUrl(A)).toBe(`/api/files/${A}`);
    expect(attachmentUrl(A, { download: true })).toBe(`/api/files/${A}?download=1`);
  });

  it("lists the referenced attachment ids once each", () => {
    expect(attachmentIdsIn(doc)).toEqual([A, B]);
    expect(attachmentIdsIn(null)).toEqual([]);
  });

  it("puts the alt text and the file name into the plain text, never the id", () => {
    const text = extractPlainText(doc);
    expect(text).toContain("Login screen STK-7");
    expect(text).toContain("server.log");
    expect(text).not.toContain(A);
    expect(text.split("\n")).toContain("Login screen STK-7");
  });

  it("finds and strips upload placeholders (never saved)", () => {
    const withUpload: RichTextDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "attachmentUpload", attrs: { token: "t" } },
        { type: "blockquote", content: [{ type: "attachmentUpload", attrs: { token: "u" } }] },
      ],
    };
    expect(hasPendingUploads(withUpload)).toBe(true);
    expect(hasPendingUploads(doc)).toBe(false);
    expect(hasPendingUploads(null)).toBe(false);
    const stripped = withoutPendingUploads(withUpload);
    expect(hasPendingUploads(stripped)).toBe(false);
    expect(stripped.content).toHaveLength(2);
    expect(withoutPendingUploads(doc)).toBe(doc);
  });

  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});
