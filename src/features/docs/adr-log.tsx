"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RelativeTime } from "@/features/issue/client-utils";
import { formatAdrNumber, splitAdrTitle } from "@/lib/docs/adr";
import { ADR_STATUS_LABELS } from "@/lib/docs/constants";
import { type AdrRow, docPath } from "@/lib/docs/views";
import { issuePathForKey } from "@/lib/issues/keys";

type SortKey = "number" | "title" | "status" | "date";
type Direction = "ascending" | "descending";

const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function statusText(row: AdrRow): string {
  if (!row.status) return "—";
  if (row.status === "superseded" && row.supersededByNumber !== null) {
    return `Superseded by ${formatAdrNumber(row.supersededByNumber)}`;
  }
  return ADR_STATUS_LABELS[row.status];
}

/** The title without its "NNNN. " prefix (the number has its own column). */
function shortTitle(row: AdrRow): string {
  return splitAdrTitle(row.title)?.title || row.title;
}

const COMPARE: Record<SortKey, (a: AdrRow, b: AdrRow) => number> = {
  number: (a, b) => a.number - b.number,
  title: (a, b) => shortTitle(a).localeCompare(shortTitle(b)),
  status: (a, b) => statusText(a).localeCompare(statusText(b)) || a.number - b.number,
  date: (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.number - b.number,
};

/** ADR-4 log: number, title, status, date and linked issues; sortable by any column. */
export function AdrLog({ rows, projectKey }: { rows: AdrRow[]; projectKey: string }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: Direction }>({
    key: "number",
    direction: "ascending",
  });

  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="font-medium">No ADRs yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use “New ADR”, or import the handbook’s decisions.
        </p>
      </section>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const result = COMPARE[sort.key](a, b);
    return sort.direction === "ascending" ? result : -result;
  });

  function header(key: SortKey, label: string, className: string) {
    const active = sort.key === key;
    const Icon = sort.direction === "ascending" ? ArrowUp : ArrowDown;
    return (
      <th
        scope="col"
        aria-sort={active ? sort.direction : "none"}
        className={`px-3 py-2 font-medium ${className}`}
      >
        <button
          type="button"
          onClick={() =>
            setSort((current) => ({
              key,
              direction:
                current.key === key && current.direction === "ascending"
                  ? "descending"
                  : "ascending",
            }))
          }
          className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {label}
          {active ? <Icon aria-hidden="true" className="size-3" /> : null}
        </button>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">Architecture decision records in {projectKey}</caption>
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            {header("number", "Number", "w-24")}
            {header("title", "Title", "")}
            {header("status", "Status", "w-56")}
            {header("date", "Date", "w-32")}
            <th scope="col" className="w-48 px-3 py-2 font-medium">
              Linked issues
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/40">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {formatAdrNumber(row.number)}
              </td>
              <td className="max-w-0 px-3 py-2">
                <Link
                  href={docPath(projectKey, row.id)}
                  className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="sr-only">ADR {formatAdrNumber(row.number)}: </span>
                  {shortTitle(row)}
                </Link>
              </td>
              <td className="px-3 py-2">{statusText(row)}</td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                <span
                  title={`Updated ${DATE_FORMAT.format(row.updatedAt)}`}
                  suppressHydrationWarning
                >
                  {DATE_FORMAT.format(row.createdAt)}
                </span>
                <span className="sr-only">
                  , updated <RelativeTime date={row.updatedAt} />
                </span>
              </td>
              <td className="px-3 py-2">
                {row.linkedIssueKeys.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {row.linkedIssueKeys.map((key) => (
                      <Link key={key} href={issuePathForKey(key)} className="issue-ref-chip">
                        {key}
                      </Link>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
