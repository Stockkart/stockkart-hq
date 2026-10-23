import { Skeleton } from "@/components/ui/skeleton";

/** Route loading shells of the service pages (README "Performance"). */

export function ServiceGridSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto flex max-w-6xl flex-col gap-4"
    >
      <span className="sr-only">Loading services…</span>
      <div className="flex items-baseline justify-between gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
    </div>
  );
}

export function ServiceDetailSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto flex max-w-5xl flex-col gap-6"
    >
      <span className="sr-only">Loading service…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
