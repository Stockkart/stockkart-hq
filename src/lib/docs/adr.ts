import { type AdrStatus } from "./constants";

/**
 * ADR numbering and status text (ADR-1, ADR-2). Isomorphic.
 */

/** `11` → `0011`. */
export function formatAdrNumber(number: number): string {
  return String(number).padStart(4, "0");
}

/** `11` → `ADR-0011` (banners, menus); "this ADR" without a number. */
export function adrLabel(number: number | null): string {
  return number === null ? "this ADR" : `ADR-${formatAdrNumber(number)}`;
}

/** The doc title of an ADR: `0011. Delete completed startup migrations`. */
export function adrTitle(number: number, title: string): string {
  return `${formatAdrNumber(number)}. ${title}`;
}

/** `0011. Title` → `{ number: 11, title: "Title" }`; null if it has no `NNNN.` prefix. */
export function splitAdrTitle(value: string): { number: number; title: string } | null {
  const match = /^\s*(\d{1,6})\.\s*(.*)$/.exec(value);
  if (!match?.[1]) return null;
  return { number: Number(match[1]), title: (match[2] ?? "").trim() };
}

export interface ParsedAdrStatus {
  status: AdrStatus;
  /** For `Superseded by NNNN`: the superseding ADR's number. */
  supersededBy: number | null;
}

/**
 * Reads the status from the text of an ADR's "## Status" section, as written in the
 * handbook: "Accepted.", "Accepted (recorded retrospectively).", "Superseded by [0010](…)."
 * Only the start of the text counts (later lines hold "Recorded against …"). Unknown text
 * is null so the caller can warn instead of guessing.
 */
export function parseAdrStatus(text: string): ParsedAdrStatus | null {
  // Backticks and emphasis are formatting, not status: "`Accepted`" is "Accepted".
  const value = text.replace(/[`*_]/g, "").trim().toLowerCase();
  const superseded = /^superseded\s+by\s*\[?\s*(?:adr[- ]?)?(\d{1,6})/.exec(value);
  if (superseded?.[1]) return { status: "superseded", supersededBy: Number(superseded[1]) };
  if (/^superseded\b/.test(value)) return { status: "superseded", supersededBy: null };
  if (/^accepted\s*\(\s*recorded retrospectively\s*\)/.test(value)) {
    return { status: "accepted_retrospective", supersededBy: null };
  }
  if (/^accepted\b/.test(value)) return { status: "accepted", supersededBy: null };
  if (/^deprecated\b/.test(value)) return { status: "deprecated", supersededBy: null };
  if (/^proposed\b/.test(value)) return { status: "proposed", supersededBy: null };
  return null;
}
