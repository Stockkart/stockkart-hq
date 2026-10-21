import { describe, expect, it } from "vitest";

import { contentDisposition } from "./disposition";
import { attachmentKey, diagramThumbnailKey, isAppKey, sanitizeFilename } from "./keys";

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

  it("accepts exactly the attachment and thumbnail layouts, never backups or tmp", () => {
    expect(isAppKey(attachmentKey("a.png", ID))).toBe(true);
    expect(isAppKey(diagramThumbnailKey(ID))).toBe(true);
    for (const key of [
      "",
      "backups/stockkart-hq.sql.gz",
      "tmp/stockkart-hq.sql.gz",
      "/attachments/x",
      "attachments/x.png",
      "attachments//x",
      `attachments/${ID.toLowerCase()}/../backups/x`,
      `attachments/${ID.toLowerCase()}/.hidden`,
      `attachments/${ID.toLowerCase()}/a b`,
      `attachments/${ID.toLowerCase()}/é`,
      `attachments/${ID.toLowerCase()}/a/b.png`,
      `thumbnails/diagrams/${ID.toLowerCase()}.json`,
      "thumbnails/x/y.png",
      "other/x",
    ]) {
      expect(isAppKey(key), key).toBe(false);
    }
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

  it("does not throw on a lone surrogate", () => {
    expect(contentDisposition("attachment", "a\uD800b.txt")).toBe(
      `attachment; filename="a_b.txt"; filename*=UTF-8''a_b.txt`,
    );
    expect(contentDisposition("attachment", "😀.txt")).toBe(
      `attachment; filename="__.txt"; filename*=UTF-8''%F0%9F%98%80.txt`,
    );
  });
});
