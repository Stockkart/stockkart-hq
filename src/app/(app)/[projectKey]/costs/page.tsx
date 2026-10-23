import type { Metadata } from "next";

import { CostsScreen } from "@/features/costs/costs-screen";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { localDate, periodToMonth } from "@/lib/costs/month";
import { parseCostRoute } from "@/lib/costs/route";
import { requirePageSession } from "@/server/auth/require-session";
import { costQueries } from "@/server/services";
import { costPageReads } from "@/server/services/cost-pages";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Costs · ${projectKey.toUpperCase()}` };
}

/** COST-1…8: the IMR tracker (Month, Year, Items, Settings tabs). */
export default async function CostsPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const key = resolveProjectKey(projectKey, "/costs");
  // "Today" in Stockkart's time zone (COST_TIMEZONE), not the server's UTC.
  const date = localDate(new Date());
  const today = { date, month: periodToMonth(date) };
  const route = parseCostRoute(await searchParams, today.month);
  // ONE round trip: every read takes the project by key, so nothing waits for anything.
  const [project, [items, entries, settings, reminder, services, users]] = await Promise.all([
    requireProject(key),
    Promise.all(costPageReads(costQueries, projectIdByKey(key), route, today)),
  ]);
  return (
    <CostsScreen
      projectKey={project.key}
      route={route}
      thisMonth={today.month}
      items={items}
      entries={entries}
      settings={settings}
      reminder={reminder}
      services={services}
      users={users}
    />
  );
}
