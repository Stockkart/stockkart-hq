import { describe, expect, it } from "vitest";

import { classifyUpload } from "@/lib/attachments/policy";
import { attachmentKey } from "@/server/storage/keys";

import { displayFilename, storedUploadClass } from "./attachments";

const ID = "11111111-2222-4333-8444-555555555555";

describe("storedUploadClass (ISS-9: one answer for the row and the signed PUT)", () => {
  it.each([
    ["image/png", "Screen Shot.png", "image/png"],
    ["image/svg+xml", "logo.svg", "application/octet-stream"],
    ["text/html", "x.png", "application/octet-stream"],
    ["", "server.log", "text/plain; charset=utf-8"],
    // Excel on Windows and log viewers send types the policy does not know.
    ["application/vnd.ms-excel", "export.csv", "text/csv; charset=utf-8"],
    ["text/x-log", "app.log", "text/plain; charset=utf-8"],
    // Full-width letters normalize to ".svg" in the key: active, so octet-stream.
    ["image/png", "x.ｓｖｇ", "application/octet-stream"],
    ["application/pdf", "spec.pdf", "application/pdf"],
    ["application/zip", "bundle.zip", "application/octet-stream"],
  ])("%s %s → %s, stable against the key", (mime, filename, stored) => {
    const key = attachmentKey(filename, ID);
    const upload = storedUploadClass(mime, filename, key);
    expect(upload.contentType).toBe(stored);
    // What presignUpload re-checks (assertPolicyContentType).
    expect(classifyUpload(upload.contentType, key).contentType).toBe(upload.contentType);
  });

  it("keeps only the last path segment of the display name", () => {
    expect(displayFilename("C:\\Users\\me\\shot.png")).toBe("shot.png");
    expect(displayFilename("../../backups/x.sql.gz")).toBe("x.sql.gz");
    expect(displayFilename("  ")).toBe("file");
  });
});
