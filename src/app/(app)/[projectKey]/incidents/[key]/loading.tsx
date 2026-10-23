import { Skeleton } from "@/components/ui/skeleton";

/** Incident page shell (header, timeline, side panel) while it loads. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto flex max-w-6xl flex-col gap-6"
    >
      <span className="sr-only">Loading incident…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <div className="flex gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-28" />
          ))}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-2.5 lg:border-l lg:pl-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
