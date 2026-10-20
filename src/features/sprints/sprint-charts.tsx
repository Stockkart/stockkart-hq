"use client";

import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { type Burndown, type VelocityBar } from "@/lib/sprints/views";
import { cn } from "@/lib/utils";

import { LazyBurndownChart, LazyVelocityChart } from "./lazy-charts";

/**
 * A chart with its accessible alternative (SPEC §9.5): the numbers as a table. The table is
 * always in the page (visually hidden while the chart shows, so screen readers read it);
 * the "Show table" toggle swaps the chart for the visible table. The chart itself is hidden
 * from assistive technology, since the table carries the same data.
 */
function ChartFigure({
  title,
  summary,
  chart,
  table,
}: {
  title: string;
  summary: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <figcaption id={captionId} className="text-sm font-medium">
          {title}
          <span className="block text-xs font-normal text-muted-foreground">{summary}</span>
        </figcaption>
        {/* A toggle keeps its name; `aria-pressed` tells whether the table is shown. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={asTable}
          onClick={() => setAsTable((value) => !value)}
        >
          Show table
        </Button>
      </div>
      {asTable ? null : <div aria-hidden="true">{chart}</div>}
      <div className={cn(!asTable && "sr-only", "overflow-x-auto")}>{table}</div>
    </figure>
  );
}

const cell = "border-b px-2 py-1 text-right tabular-nums";
const head = "border-b px-2 py-1 text-right font-medium text-muted-foreground";
const show = (value: number | null) => (value === null ? "–" : String(value));

/** SPR-3: remaining points per day, the ideal line and the scope. */
export function BurndownPanel({ burndown, title }: { burndown: Burndown; title?: string }) {
  const last = [...burndown.points].reverse().find((point) => point.remaining !== null);
  return (
    <ChartFigure
      title={title ?? "Burndown"}
      summary={`${burndown.committed} pts committed · ${last?.remaining ?? 0} pts remaining`}
      chart={<LazyBurndownChart points={burndown.points} />}
      table={
        <table className="w-full text-sm">
          <caption className="sr-only">Burndown by day, in story points</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(head, "text-left")}>
                Day
              </th>
              <th scope="col" className={head}>
                Remaining
              </th>
              <th scope="col" className={head}>
                Ideal
              </th>
              <th scope="col" className={head}>
                Scope
              </th>
              <th scope="col" className={head}>
                Completed
              </th>
            </tr>
          </thead>
          <tbody>
            {burndown.points.map((point) => (
              <tr key={point.key}>
                <th scope="row" className="border-b px-2 py-1 text-left font-normal">
                  {point.label}
                </th>
                <td className={cell}>{show(point.remaining)}</td>
                <td className={cell}>{point.ideal}</td>
                <td className={cell}>{show(point.scope)}</td>
                <td className={cell}>{show(point.completed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

/** SPR-4: completed points of the last closed sprints, Won't Do excluded. */
export function VelocityPanel({ bars }: { bars: VelocityBar[] }) {
  const average =
    bars.length > 0
      ? Math.round((bars.reduce((sum, bar) => sum + bar.completed, 0) / bars.length) * 10) / 10
      : 0;
  return (
    <ChartFigure
      title="Velocity"
      summary={`Last ${bars.length} closed ${bars.length === 1 ? "sprint" : "sprints"} · average ${average} pts`}
      chart={<LazyVelocityChart bars={bars} />}
      table={
        <table className="w-full text-sm">
          <caption className="sr-only">Completed story points per closed sprint</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(head, "text-left")}>
                Sprint
              </th>
              <th scope="col" className={head}>
                Completed points
              </th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.sprintId}>
                <th scope="row" className="border-b px-2 py-1 text-left font-normal">
                  {bar.name}
                </th>
                <td className={cell}>{bar.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
