"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { type MermaidResult, renderMermaid } from "./mermaid-render";

/** Re-render this long after the last keystroke, not on every one. */
export const MERMAID_PREVIEW_DELAY_MS = 400;

/**
 * Live, debounced Mermaid preview (DOC-7). Invalid syntax shows an inline error; it never
 * throws into the editor. The SVG comes only from `renderMermaid` (strict mode + DOMPurify).
 */
export function MermaidPreview({ source, className }: { source: string; className?: string }) {
  const [result, setResult] = useState<MermaidResult | null>(null);

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

  return (
    <div className={cn("flex min-h-24 flex-col justify-center overflow-auto p-2", className)}>
      {result === null ? (
        <p className="text-sm text-muted-foreground">Rendering…</p>
      ) : result.kind === "svg" ? (
        <div
          role="img"
          aria-label="Diagram preview"
          className="mermaid-preview flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
          // Safe: strict-mode mermaid output, sanitised by DOMPurify (see mermaid-render.ts).
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
      ) : result.kind === "empty" ? (
        <p className="text-sm text-muted-foreground">Write a diagram to see it here.</p>
      ) : null}
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
