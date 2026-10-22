import { Skeleton } from "@/components/ui/skeleton";

/** Route loading shells of the diagram pages (same pattern as `shell/page-skeletons.tsx`). */

function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}

/** §5.6 list: heading, toolbar, a grid of cards. */
export function DiagramGridSkeleton() {
  return (
    <Loading label="diagrams">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <Skeleton className="h-8 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-40" />
          </div>
        </div>
        <Skeleton className="h-9 w-72" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border p-2">
              <Skeleton className="aspect-[16/10] w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

/** §5.6 editor: title bar and the canvas. */
export function DiagramEditorSkeleton() {
  return (
    <Loading label="diagram">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="h-[70vh] w-full" />
      </div>
    </Loading>
  );
}
