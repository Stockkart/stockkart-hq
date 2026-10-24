"use client";

import { MermaidPreview } from "../mermaid-preview";

/**
 * A Mermaid block in the read-only view (DOC-7): the rendered diagram, as in the editor's
 * preview (strict mode, sanitised, in a shadow root; mermaid itself is loaded on demand),
 * with the source a click away. Invalid syntax shows the same inline error as the editor.
 */
export function MermaidDiagram({ source }: { source: string }) {
  return (
    <figure data-type="mermaid" className="my-4 rounded-md border">
      <MermaidPreview source={source} />
      <details className="border-t px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Show source</summary>
        <pre className="mt-2 overflow-auto">
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
