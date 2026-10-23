"use client";

import dynamic from "next/dynamic";

/** Recharts loads only in the browser and only on the Year tab (SPEC §9.2). */
export const LazyYearCategoryChart = dynamic(
  () => import("./year-chart").then((module) => module.YearCategoryChart),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden="true" className="h-[280px] animate-pulse rounded-md bg-muted/40" />
    ),
  },
);
