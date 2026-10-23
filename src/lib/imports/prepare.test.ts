import { describe, expect, it } from "vitest";

import {
  IMPORT_CELL_MAX,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_PAYLOAD_BYTES,
  IMPORT_MAX_ROWS,
} from "./constants";
import { fileSizeProblem, payloadTooLarge, prepareImport } from "./prepare";
import { applyImportInput, previewImportInput } from "./schemas";

const csv = (rows: number) =>
  ["title", ...Array.from({ length: rows }, (_, i) => `Issue ${i + 1}`)].join("\n");

describe("prepareImport (IMP-4 browser checks)", () => {
  it("accepts up to 1 MB and refuses anything larger", () => {
    expect(fileSizeProblem(IMPORT_MAX_FILE_BYTES)).toBeNull();
    expect(fileSizeProblem(IMPORT_MAX_FILE_BYTES + 1)).toMatch(/limit is 1\.0 MB/);
    expect(prepareImport(csv(1), IMPORT_MAX_FILE_BYTES + 1)).toEqual({
      ok: false,
      error: expect.stringMatching(/limit/),
    });
  });

  it("accepts 500 data rows and refuses 501", () => {
    const ok = prepareImport(csv(IMPORT_MAX_ROWS), 100);
    expect(ok.ok && ok.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(prepareImport(csv(IMPORT_MAX_ROWS + 1), 100)).toEqual({
      ok: false,
      error: `The file has ${IMPORT_MAX_ROWS + 1} rows; import at most ${IMPORT_MAX_ROWS} at a time (split the file)`,
    });
  });

  it("needs a header row and at least one data row", () => {
    expect(prepareImport("", 0)).toEqual({ ok: false, error: "The file is empty" });
    expect(prepareImport("title\n", 6)).toEqual({
      ok: false,
      error: "The file has a header row but no issues",
    });
  });

  it("reports malformed CSV", () => {
    expect(prepareImport('title\n"open', 11)).toEqual({
      ok: false,
      error: "Not a valid CSV file. Line 2: a quoted field is not closed",
    });
  });

  it("trims headers and keeps rows as read", () => {
    expect(prepareImport("\uFEFF Title ,Type\r\n x ,bug\r\n", 20)).toEqual({
      ok: true,
      headers: ["Title", "Type"],
      rows: [[" x ", "bug"]],
    });
  });

  it("flags a mapped payload the server would refuse as too large", () => {
    expect(payloadTooLarge({ rows: [["small"]] })).toBe(false);
    expect(payloadTooLarge({ rows: [["x".repeat(IMPORT_MAX_PAYLOAD_BYTES)]] })).toBe(true);
  });
});

describe("import action schemas (IMP-4 server limits)", () => {
  const rows = (count: number) => Array.from({ length: count }, (_, i) => [`Issue ${i}`]);
  const base = { projectKey: "STK", filename: "issues.csv", fields: ["title"] };

  it("takes at most 500 rows per import", () => {
    expect(previewImportInput.safeParse({ ...base, rows: rows(IMPORT_MAX_ROWS) }).success).toBe(
      true,
    );
    const over = previewImportInput.safeParse({ ...base, rows: rows(IMPORT_MAX_ROWS + 1) });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toBe(`Import at most ${IMPORT_MAX_ROWS} rows at a time`);
    expect(
      applyImportInput.safeParse({
        importId: "0f1e2d3c-4b5a-4968-8776-5544332211aa",
        fields: ["title"],
        rows: rows(IMPORT_MAX_ROWS + 1),
      }).success,
    ).toBe(false);
  });

  it("refuses over-long cells, rows of the wrong width and fields without a title", () => {
    expect(
      previewImportInput.safeParse({ ...base, rows: [["x".repeat(IMPORT_CELL_MAX + 1)]] }).success,
    ).toBe(false);
    expect(previewImportInput.safeParse({ ...base, rows: [["a", "b"]] }).success).toBe(false);
    expect(
      previewImportInput.safeParse({ ...base, fields: ["type"], rows: [["bug"]] }).success,
    ).toBe(false);
    expect(
      previewImportInput.safeParse({ ...base, fields: ["title", "title"], rows: [["a", "b"]] })
        .success,
    ).toBe(false);
  });

  it("keeps only the file's own name, without path or control characters", () => {
    const parsed = previewImportInput.parse({
      ...base,
      filename: "C:\\Users\\me\\Down\u0007loads/ issues\u0000.csv ",
      rows: rows(1),
    });
    expect(parsed.filename).toBe("issues.csv");
    // Bidi overrides and zero-width characters cannot disguise the name.
    expect(
      previewImportInput.parse({ ...base, filename: "report\u202Evsc.exe\u200B", rows: rows(1) })
        .filename,
    ).toBe("reportvsc.exe");
    expect(previewImportInput.safeParse({ ...base, filename: "/", rows: rows(1) }).success).toBe(
      false,
    );
  });
});
