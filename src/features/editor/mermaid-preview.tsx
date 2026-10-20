"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { type MermaidResult, renderMermaid } from "./mermaid-render";

/** Re-render this long after the last keystroke, not on every one. */
export const MERMAID_PREVIEW_DELAY_MS = 400;

/** Sizes the diagram inside its shadow root (page styles do not reach in there). */
const SHADOW_STYLE = "<style>:host{display:block}svg{max-width:100%;height:auto}</style>";

/**
 * Live, debounced Mermaid preview (DOC-7). Invalid syntax shows an inline error; it never
 * throws into the editor. The SVG comes only from `renderMermaid` (strict mode + DOMPurify)
 * and goes into a shadow root inside a paint-contained box, so the `<style>` mermaid puts in
 * its SVG applies to the diagram only and nothing can be drawn outside the preview.
 */
export function MermaidPreview({ source, className }: { source: string; className?: string }) {
  const [result, setResult] = useState<MermaidResult | null>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderMermaid(source).then((next) => {
        // A newer source may have started rendering meanwhile; drop stale results.
        if (!cancelled) setResult(next);
      });
    }, MERMAID_PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);

  const svg = result?.kind === "svg" ? result.svg : null;
  useEffect(() => {
    const element = host.current;
    if (!element || svg === null) return;
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    // Safe: strict-mode mermaid output, sanitised by DOMPurify (see mermaid-render.ts).
    shadow.innerHTML = `${SHADOW_STYLE}${svg}`;
  }, [svg]);

  return (
    <div className={cn("flex min-h-24 flex-col justify-center overflow-auto p-2", className)}>
      {result === null ? (
        <p className="text-sm text-muted-foreground">Rendering…</p>
      ) : result.kind === "empty" ? (
        <p className="text-sm text-muted-foreground">Write a diagram to see it here.</p>
      ) : null}
      {/* Always mounted (hidden when there is no diagram) so its shadow root is reused. */}
      <div
        ref={host}
        role="img"
        aria-label="Diagram preview"
        hidden={svg === null}
        className="relative overflow-hidden [contain:paint]"
      />
      <div aria-live="polite">
        {result?.kind === "error" ? (
          <p role="alert" className="text-sm whitespace-pre-wrap text-destructive">
            <span className="font-medium">Diagram error: </span>
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
