import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading shells (`loading.tsx`). Next.js shows them the moment a link is
 * clicked (and prefetches them with the link in production), so a click gets the new
 * page's frame at once while its data loads. Shapes follow the real pages, so nothing
 * jumps when the content arrives. One polite status message for screen readers.
 */

function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}

function Heading({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <Skeleton className={wide ? "h-8 w-64" : "h-8 w-40"} />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

function Rows({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y rounded-lg border">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Issue list, backlog: heading, filter bar, rows. */
export function ListPageSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Heading />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-56" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-20" />
          ))}
        </div>
        <Rows />
      </div>
    </Loading>
  );
}

export function BoardSkeleton() {
  return (
    <Loading label="board">
      <div className="flex flex-col gap-4">
        <Heading />
        <div className="grid [grid-auto-columns:minmax(16rem,1fr)] grid-flow-col gap-4 overflow-hidden">
          {Array.from({ length: 4 }, (_, column) => (
            <div key={column} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2">
              <Skeleton className="h-5 w-24" />
              {Array.from({ length: 3 }, (_, card) => (
                <Skeleton key={card} className="h-16 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

/** Issue detail: header, description and the side panel. */
export function IssueSkeleton() {
  return (
    <Loading label="issue">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-2/3" />
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-6 h-24 w-full" />
          </div>
          <div className="flex flex-col gap-2.5 lg:border-l lg:pl-6">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Loading>
  );
}

/** Doc page (read mode by default; the page tree is a drawer). */
export function DocSkeleton() {
  return (
    <Loading label="document">
      {/* Docs UX: a header bar, then the reading column (no tree, panels collapsed). */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b pb-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-8 w-40" />
        </div>
        <div className="mx-auto flex w-full max-w-[72ch] flex-col gap-4">
          <Skeleton className="h-9 w-2/3" />
          <div className="flex gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-5 w-24 rounded-full" />
            ))}
          </div>
          <Skeleton className="min-h-[60vh] w-full" />
        </div>
      </div>
    </Loading>
  );
}

/** Docs list, ADR log, My Work, Todos: a heading and rows. */
export function SimplePageSkeleton({ label, narrow = false }: { label: string; narrow?: boolean }) {
  return (
    <Loading label={label}>
      <div className={narrow ? "mx-auto flex max-w-3xl flex-col gap-4" : "flex flex-col gap-4"}>
        <Heading wide />
        <Rows count={narrow ? 6 : 10} />
      </div>
    </Loading>
  );
}

/** Any project page without its own shell; also shown while the docs layout loads. */
export function ProjectPageSkeleton() {
  return (
    <Loading label="page">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Heading />
        <Rows />
      </div>
    </Loading>
  );
}
