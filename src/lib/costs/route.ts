import { COST_TABS, type CostTab } from "./constants";
import { addMonths, isMonth, isYear, type Month, yearOf } from "./month";

/**
 * The /<KEY>/costs URL (COST-1): `?tab=month|year|items|settings`, `?month=YYYY-MM` (Month
 * tab, default this month) and `?year=YYYY` (Year tab, default this year). Anything
 * malformed falls back to the default, so a bad link still opens the page.
 */
export interface CostRoute {
  tab: CostTab;
  month: Month;
  year: number;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseCostRoute(
  params: Record<string, string | string[] | undefined>,
  thisMonth: Month,
): CostRoute {
  const tab = first(params.tab);
  const month = first(params.month);
  const year = Number(first(params.year));
  const parsedMonth = isMonth(month) ? month : thisMonth;
  return {
    tab: COST_TABS.find((value) => value === tab) ?? "month",
    month: parsedMonth,
    year: isYear(year) ? year : isMonth(month) ? yearOf(parsedMonth) : yearOf(thisMonth),
  };
}

/**
 * Which entries a tab needs (months, inclusive): the Month tab its month and the 12 before
 * (last month's change, and yearly items' run-rate for both months); the Year tab its year
 * and the 11 months before January (the run-rate of yearly items paid last year). The
 * other tabs need only this month.
 */
export function entriesRange(route: CostRoute, thisMonth: Month): { from: Month; to: Month } {
  if (route.tab === "month") return { from: addMonths(route.month, -12), to: route.month };
  if (route.tab === "year") {
    const january = `${route.year}-01` as Month;
    return { from: addMonths(january, -11), to: addMonths(january, 11) };
  }
  return { from: thisMonth, to: thisMonth };
}

export function costsHref(projectKey: string, query: Partial<CostRoute> = {}): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab !== "month") params.set("tab", query.tab);
  if (query.month) params.set("month", query.month);
  if (query.year !== undefined) params.set("year", String(query.year));
  const search = params.toString();
  return `/${projectKey}/costs${search ? `?${search}` : ""}`;
}

export function costsExportHref(
  projectKey: string,
  scope: { month: Month } | { year: number },
): string {
  const search = "month" in scope ? `month=${scope.month}` : `year=${scope.year}`;
  return `/${projectKey}/costs/export?${search}`;
}
