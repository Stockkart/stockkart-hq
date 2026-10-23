"use client";

import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { MultiSelect, type SelectOption } from "@/components/ui/select";
import { userOptions } from "@/features/issue/field-options";
import { StatusGlyph } from "@/features/issue/issue-badges";
import { STATUS_CATEGORIES, type StatusCategory } from "@/lib/issues/constants";
import { ASSIGNEE_ME, ASSIGNEE_NONE } from "@/lib/issues/filters";
import { type NamedOption } from "@/lib/issues/views";
import { ROADMAP_ZOOMS, type RoadmapZoom, ZOOM_LABELS } from "@/lib/roadmap/constants";
import {
  EMPTY_ROADMAP_FILTERS,
  hasRoadmapFilters,
  type RoadmapFilters,
  roadmapSearchParams,
} from "@/lib/roadmap/filters";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<StatusCategory, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/**
 * RDM-1 toolbar: zoom (links, so each zoom is a shareable URL) and the component /
 * assignee / status-category filters. All state is in the URL; the page re-renders with
 * the parsed values, and the picks show at once (optimistic) while it does.
 */
export function RoadmapToolbar({
  zoom,
  filters,
  components,
  users,
}: {
  zoom: RoadmapZoom;
  filters: RoadmapFilters;
  components: NamedOption[];
  users: NamedOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, showOptimistic] = useOptimistic(filters);

  const hrefFor = (next: { zoom: RoadmapZoom; filters: RoadmapFilters }) => {
    const query = roadmapSearchParams(next).toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  function apply(next: RoadmapFilters) {
    startTransition(() => {
      showOptimistic(next);
      router.replace(hrefFor({ zoom, filters: next }), { scroll: false });
    });
  }

  const categoryOptions: SelectOption<StatusCategory>[] = STATUS_CATEGORIES.map((category) => ({
    value: category,
    label: CATEGORY_LABELS[category],
    icon: <StatusGlyph category={category} />,
  }));
  const assigneeOptions: SelectOption<string>[] = [
    { value: ASSIGNEE_ME, label: "Me" },
    { value: ASSIGNEE_NONE, label: "Unassigned" },
    ...userOptions(users),
  ];
  const componentOptions: SelectOption<string>[] = components.map((component) => ({
    value: component.id,
    label: component.name,
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Zoom" className="flex rounded-md border p-0.5">
        {ROADMAP_ZOOMS.map((level) => (
          <Link
            key={level}
            href={hrefFor({ zoom: level, filters })}
            scroll={false}
            aria-current={level === zoom ? "page" : undefined}
            className={cn(
              "rounded-sm px-2.5 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              level === zoom
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ZOOM_LABELS[level]}
          </Link>
        ))}
      </nav>
      <div
        role="search"
        aria-label="Filter epics"
        aria-busy={pending || undefined}
        className="flex flex-wrap items-center gap-2"
      >
        <Filter
          label="Component"
          options={componentOptions}
          selected={shown.components}
          onChange={(components) => apply({ ...shown, components })}
        />
        <Filter
          label="Assignee"
          options={assigneeOptions}
          selected={shown.assignees}
          onChange={(assignees) => apply({ ...shown, assignees })}
        />
        <Filter
          label="Status"
          options={categoryOptions}
          selected={shown.categories}
          onChange={(categories) => apply({ ...shown, categories })}
        />
        {hasRoadmapFilters(shown) ? (
          <Button variant="ghost" size="sm" onClick={() => apply(EMPTY_ROADMAP_FILTERS)}>
            <X aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Filter<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: SelectOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const names = options.filter((option) => selected.includes(option.value)).map((o) => o.label);
  return (
    <MultiSelect
      variant="chip"
      label={label}
      aria-label={selected.length > 0 ? `${label}: ${names.join(", ")}` : `${label}: any`}
      className={selected.length > 0 ? "border-transparent bg-secondary" : undefined}
      value={selected}
      options={options}
      onChange={(next) => onChange(next)}
    >
      {() => (
        <>
          {label}
          {selected.length > 0 ? (
            <span className="rounded bg-background px-1 text-xs tabular-nums">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown aria-hidden="true" />
        </>
      )}
    </MultiSelect>
  );
}
