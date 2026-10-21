import { type Disposition } from "@/lib/attachments/policy";

/**
 * A `Content-Disposition` value (RFC 6266) with an ASCII `filename` fallback and the exact
 * name as UTF-8 in `filename*` (RFC 8187). Quotes, backslashes and control characters never
 * reach the header, so a crafted file name cannot inject parameters or headers.
 */
export function contentDisposition(disposition: Disposition, filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  // Control characters (including CR/LF) dropped; the rest of the name is kept as typed.
  const cleaned = Array.from(base)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  const name = cleaned === "" ? "file" : cleaned.slice(0, 200);
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\%]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
