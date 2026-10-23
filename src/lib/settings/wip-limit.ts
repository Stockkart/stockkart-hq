import { setStatusWipLimitInput } from "./schemas";

/**
 * BRD-5: the WIP limit field's text → the value the server takes (null for an empty field,
 * meaning no limit), or the same message the server would give. Isomorphic.
 */
export type WipLimitText = { ok: true; value: number | null } | { ok: false; error: string };

const limitSchema = setStatusWipLimitInput.shape.wipLimit;

export function parseWipLimitText(text: string): WipLimitText {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: "Enter a whole number" };
  const parsed = limitSchema.safeParse(Number(trimmed));
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a whole number" };
}
