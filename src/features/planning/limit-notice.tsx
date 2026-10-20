/** Shown when a planning page hit `ISSUE_LIST_LIMIT` rows. */
export function LimitNotice({ count, limit }: { count: number; limit: number }) {
  if (count < limit) return null;
  return (
    <p role="note" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
      Showing the first {limit.toLocaleString("en")} issues. Use the filters to narrow the list.
    </p>
  );
}
