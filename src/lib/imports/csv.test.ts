import { describe, expect, it } from "vitest";

import { escapeCsvCell, parseCsv } from "./csv";

describe("parseCsv (IMP-4, RFC 4180)", () => {
  it("reads plain rows", () => {
    expect(parseCsv("title,type\nFix it,bug\nShip it,story\n")).toEqual({
      rows: [
        ["title", "type"],
        ["Fix it", "bug"],
        ["Ship it", "story"],
      ],
      error: null,
    });
  });

  it("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    const { rows, error } = parseCsv(
      'title,description\n"Fix, then ship","He said ""no""\nthen ""yes"""\n',
    );
    expect(error).toBeNull();
    expect(rows).toEqual([
      ["title", "description"],
      ["Fix, then ship", 'He said "no"\nthen "yes"'],
    ]);
  });

  it("strips a UTF-8 BOM and accepts CRLF, lone CR and no final newline", () => {
    expect(parseCsv("\uFEFFtitle,points\r\nA,1\rB,2\nC,3").rows).toEqual([
      ["title", "points"],
      ["A", "1"],
      ["B", "2"],
      ["C", "3"],
    ]);
  });

  it("keeps CRLF inside a quoted field as written", () => {
    expect(parseCsv('a\r\n"line 1\r\nline 2"\r\n').rows).toEqual([["a"], ["line 1\r\nline 2"]]);
  });

  it("skips blank lines but keeps rows of empty cells", () => {
    expect(parseCsv("a,b\n\n,\n\nx,y\n\n").rows).toEqual([
      ["a", "b"],
      ["", ""],
      ["x", "y"],
    ]);
  });

  it("keeps empty fields, a trailing empty field and a quoted empty field", () => {
    expect(parseCsv('a,,c,\n"",x,""\n').rows).toEqual([
      ["a", "", "c", ""],
      ["", "x", ""],
    ]);
  });

  it("keeps a stray quote inside an unquoted field as text", () => {
    expect(parseCsv('size,note\n5" screen,ok\n').rows).toEqual([
      ["size", "note"],
      ['5" screen', "ok"],
    ]);
  });

  it("reports an unclosed quote and text after a closing quote, with the line", () => {
    expect(parseCsv('a\n"open\nstill open').error).toBe("Line 3: a quoted field is not closed");
    expect(parseCsv('a,b\n"x"y,z').error).toBe("Line 2: text after a closing quote");
  });

  it("does not trim cells (validation trims what it reads)", () => {
    expect(parseCsv("  a , b  ").rows).toEqual([["  a ", " b  "]]);
  });

  it("parses an empty file to no rows", () => {
    expect(parseCsv("")).toEqual({ rows: [], error: null });
    expect(parseCsv("\uFEFF")).toEqual({ rows: [], error: null });
  });
});

describe("escapeCsvCell (CSV injection on export)", () => {
  it.each(["=SUM(A1:A9)", "+1", "-2+3", "@cmd", "\tTAB", "\rCR"])(
    "neutralises a formula-like value %j with a leading quote",
    (value) => {
      expect(escapeCsvCell(value).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    },
  );

  it("quotes values with commas, quotes or line breaks, and doubles quotes", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(escapeCsvCell("=1,2")).toBe(`"'=1,2"`);
  });

  it("leaves ordinary values alone and writes empty for null", () => {
    expect(escapeCsvCell("Fix login")).toBe("Fix login");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(-3)).toBe("-3");
    expect(escapeCsvCell("-3")).toBe("'-3");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("round-trips through parseCsv (apart from the formula guard)", () => {
    const values = ["plain", "a,b", 'q"uote', "multi\nline", ""];
    const line = values.map(escapeCsvCell).join(",");
    expect(parseCsv(line).rows).toEqual([values]);
  });
});
