import * as React from "react";

import { cn } from "@/lib/utils";

/** shadcn/ui skeleton: a pulsing placeholder block. Decorative (hidden from screen readers). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
