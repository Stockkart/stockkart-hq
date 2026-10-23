import { Skeleton } from "@/components/ui/skeleton";

/** Route loading shell of /<KEY>/costs (README "Performance"). */
export function CostsSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto flex max-w-6xl flex-col gap-4"
    >
      <span className="sr-only">Loading costs…</span>
      <div className="flex items-baseline justify-between gap-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-9 w-80" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}
