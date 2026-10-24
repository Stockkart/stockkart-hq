import DOMPurify from "dompurify";
import { type Mermaid, type MermaidConfig } from "mermaid";

import { type ResolvedTheme } from "@/lib/theme/theme";

/**
 * Client-only Mermaid rendering (DOC-7, S-8).
 *
 * - mermaid is imported dynamically, so its large bundle loads only when a diagram is shown
 *   (SPEC §9.2), and it is initialised with `startOnLoad: false` (we render on demand,
 *   never by scanning the page) and `securityLevel: "strict"` (no click handlers, encoded
 *   tags in labels).
 * - `htmlLabels: false` makes labels plain SVG `<text>`, so the output needs no
 *   `<foreignObject>` HTML (which the SVG sanitiser profile below removes anyway).
 * - `secure` stops `%%{init: …}%%` directives in a diagram from changing the security level
 *   or injecting CSS (`themeCSS`, `themeVariables`, fonts) into the page.
 * - mermaid returns SVG as a markup string, and the preview inserts it with innerHTML. Even
 *   strict mode output is passed through DOMPurify with the SVG profile first: defence in
 *   depth, so a mermaid bug can never put script, event handlers or HTML into the page. The
 *   preview then puts it in a shadow root, so the SVG's own `<style>` cannot reach the page.
 * - The theme follows the app (mermaid's `default` / `dark`, README "Dark mode"). Only this
 *   module picks it (a diagram's directives cannot: `theme` is in `secure`), by
 *   re-initialising with the same locked-down config; renders are queued one at a time, so
 *   a theme switch never changes the config in the middle of a render.
 */

export type MermaidResult =
  { kind: "svg"; svg: string } | { kind: "error"; message: string } | { kind: "empty" };

const MAX_ERROR_LENGTH = 400;

/** The locked-down config; only `theme` varies, and only between mermaid's built-ins. */
function mermaidConfig(theme: ResolvedTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    // Light keeps the "neutral" theme the app used before dark mode, so diagrams look the same.
    theme: theme === "dark" ? "dark" : "neutral",
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "maxEdges",
      "htmlLabels",
      "theme",
      "themeCSS",
      "themeVariables",
      "fontFamily",
      "altFontFamily",
    ],
    // Bounds for very large diagrams (the defaults, stated so they cannot be raised).
    maxTextSize: 50_000,
    maxEdges: 500,
  };
}

let loader: Promise<Mermaid> | null = null;
/** The theme mermaid was last initialised with (null: not yet). */
let initialisedTheme: ResolvedTheme | null = null;

function loadMermaid(): Promise<Mermaid> {
  loader ??= import("mermaid")
    .then(({ default: mermaid }) => mermaid)
    .catch((error: unknown) => {
      // Let the next render retry (e.g. the chunk failed to download once).
      loader = null;
      throw error;
    });
  return loader;
}

let renderCount = 0;
/** The tail of the render queue (renders never reject, so the chain never breaks). */
let queue: Promise<unknown> = Promise.resolve();

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.trim() || "Invalid Mermaid syntax";
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

/**
 * Renders Mermaid source to sanitised SVG markup in the given theme, or an error message.
 * Never throws.
 */
export function renderMermaid(
  source: string,
  theme: ResolvedTheme = "light",
): Promise<MermaidResult> {
  if (source.trim() === "") return Promise.resolve({ kind: "empty" });
  const next = queue.then(() => renderNow(source, theme));
  queue = next;
  return next;
}

async function renderNow(source: string, theme: ResolvedTheme): Promise<MermaidResult> {
  renderCount += 1;
  const id = `hq-mermaid-${renderCount}`;
  try {
    const mermaid = await loadMermaid();
    if (initialisedTheme !== theme) {
      mermaid.initialize(mermaidConfig(theme));
      initialisedTheme = theme;
    }
    // parse() throws a readable syntax error before render() touches the DOM.
    await mermaid.parse(source);
    const { svg } = await mermaid.render(id, source);
    const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    return { kind: "svg", svg: clean };
  } catch (error) {
    return { kind: "error", message: errorMessage(error) };
  } finally {
    // mermaid renders into a temporary element; on a failure it can be left behind.
    document.getElementById(`d${id}`)?.remove();
  }
}
