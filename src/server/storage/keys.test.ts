import { describe, expect, it } from "vitest";

import { contentDisposition } from "./disposition";
import {
  attachmentKey,
  diagramThumbnailKey,
  isUploadableKey,
  isValidKey,
  sanitizeFilename,
} from "./keys";

const ID = "AAAAAAAA-2222-4333-8444-555555555555";

describe("object keys (S-5 layout)", () => {
  it("builds attachments/<uuid>/<sanitized-filename>", () => {
    expect(attachmentKey("My Report (v2).pdf", ID)).toBe(
      "attachments/aaaaaaaa-2222-4333-8444-555555555555/My_Report_v2_.pdf",
    );
    expect(attachmentKey("x.png")).toMatch(/^attachments\/[0-9a-f-]{36}\/x\.png$/);
    expect(() => attachmentKey("x.png", "not-a-uuid")).toThrow();
  });

  it("builds thumbnails/diagrams/<id>.png", () => {
    expect(diagramThumbnailKey(ID)).toBe(
      "thumbnails/diagrams/aaaaaaaa-2222-4333-8444-555555555555.png",
    );
    expect(() => diagramThumbnailKey("../x")).toThrow();
  });

  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\notes.txt", "notes.txt"],
    [".htaccess", "htaccess"],
    ["Café menu.PNG", "Cafe_menu.PNG"],
    ["", "file"],
    ["...", "file"],
    ["日本語", "file"],
    ["a\r\nb.txt", "a_b.txt"],
  ])("sanitizes %j to %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("caps long names at 100 characters, keeping the extension", () => {
    const name = sanitizeFilename(`${"a".repeat(300)}.png`);
    expect(name).toHaveLength(100);
    expect(name.endsWith(".png")).toBe(true);
  });

  it("accepts only well-formed keys under our prefixes", () => {
    expect(isValidKey(attachmentKey("a.png", ID))).toBe(true);
    expect(isValidKey("backups/stockkart-hq.sql.gz")).toBe(true);
    for (const key of [
      "",
      "/attachments/x",
      "attachments//x",
      "attachments/../backups/x",
      "attachments/./x",
      "other/x",
      "attachments/a b",
      "attachments/é",
    ]) {
      expect(isValidKey(key), key).toBe(false);
    }
    expect(isUploadableKey("backups/x")).toBe(false);
    expect(isUploadableKey("tmp/x")).toBe(false);
    expect(isUploadableKey(diagramThumbnailKey(ID))).toBe(true);
  });
});

describe("contentDisposition", () => {
  it("never lets a file name inject parameters or headers", () => {
    const value = contentDisposition("attachment", 'evil".html\r\nSet-Cookie: x=1; a=%');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.startsWith('attachment; filename="evil_.htmlSet-Cookie: x=1; a=_"')).toBe(true);
    expect(value).toContain("filename*=UTF-8''evil%22.htmlSet-Cookie%3A%20x%3D1%3B%20a%3D%25");
  });

  it("falls back to file for an empty name and strips paths", () => {
    expect(contentDisposition("inline", "")).toBe(`inline; filename="file"; filename*=UTF-8''file`);
    expect(contentDisposition("inline", "../a.png")).toBe(
      `inline; filename="a.png"; filename*=UTF-8''a.png`,
    );
  });
});
