"use client";

import dynamic from "next/dynamic";

/**
 * Recharts loads only in the browser and only on the sprint pages (SPEC §9.2). The
 * placeholder keeps the layout from jumping while the chunk loads.
 */
const placeholder = (height: string) =>
  function ChartPlaceholder() {
    return <div aria-hidden="true" className={`${height} animate-pulse rounded-md bg-muted/40`} />;
  };

export const LazyBurndownChart = dynamic(
  () => import("./charts").then((module) => module.BurndownChart),
  { ssr: false, loading: placeholder("h-[260px]") },
);

export const LazyVelocityChart = dynamic(
  () => import("./charts").then((module) => module.VelocityChart),
  { ssr: false, loading: placeholder("h-[220px]") },
);
