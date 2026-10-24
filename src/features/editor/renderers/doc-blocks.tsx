import { MermaidDiagram } from "./mermaid-diagram";
import { type NodeRenderers } from "./types";

/** Doc blocks (DOC-1, DOC-7) in the read-only view, e.g. the template preview. */

export const tableRenderers: NodeRenderers = {
  table: ({ index, children }) => (
    <table key={index}>
      <tbody>{children}</tbody>
    </table>
  ),
  tableRow: ({ index, children }) => <tr key={index}>{children}</tr>,
  tableHeader: ({ index, children }) => <th key={index}>{children}</th>,
  tableCell: ({ index, children }) => <td key={index}>{children}</td>,
};

export const calloutRenderers: NodeRenderers = {
  callout: ({ node, index, children }) => (
    <aside
      key={index}
      role="note"
      data-type="callout"
      data-tone={node.attrs?.tone === "warning" ? "warning" : "info"}
    >
      {children}
    </aside>
  ),
};

export const mermaidRenderers: NodeRenderers = {
  mermaid: ({ node, index }) => {
    // The read-only view renders the diagram (like the editor's preview), source on demand.
    const source = node.attrs?.source;
    return <MermaidDiagram key={index} source={typeof source === "string" ? source : ""} />;
  },
};
