import Link from "next/link";

import { RelativeTime } from "@/features/issue/client-utils";
import { DOC_STATUS_LABELS, DOC_TYPE_LABELS } from "@/lib/docs/constants";
import { docPath, type DocTreeItem } from "@/lib/docs/views";

/** DOC-3/DOC-4 list view: every doc with type, status, owner and last update; newest first. */
export function DocList({ docs, projectKey }: { docs: DocTreeItem[]; projectKey: string }) {
  if (docs.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="font-medium">No docs yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a page, start from a template, or import the engineering handbook.
        </p>
      </section>
    );
  }
  const sorted = [...docs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">Docs in {projectKey}, most recently updated first</caption>
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="w-36 px-3 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="w-28 px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="w-36 px-3 py-2 font-medium">
              Owner
            </th>
            <th scope="col" className="w-44 px-3 py-2 font-medium">
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((doc) => (
            <tr key={doc.id} className="border-b last:border-b-0 hover:bg-muted/40">
              <td className="max-w-0 px-3 py-2">
                <Link
                  href={docPath(projectKey, doc.id)}
                  className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {doc.title}
                </Link>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{DOC_TYPE_LABELS[doc.type]}</td>
              <td className="px-3 py-2">{DOC_STATUS_LABELS[doc.status]}</td>
              <td className="px-3 py-2 text-muted-foreground">{doc.ownerName ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">
                <RelativeTime date={doc.updatedAt} />
                {doc.updatedByName ? ` · ${doc.updatedByName}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
