"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CostTab } from "@/lib/costs/constants";
import { type Month } from "@/lib/costs/month";
import { type CostRoute, costsHref } from "@/lib/costs/route";
import {
  type CostEntryView,
  type CostItemView,
  type CostReminder,
  type CostServiceOption,
  type CostSettingsView,
  type CostUserOption,
} from "@/lib/costs/views";

import { CostReminderBanner } from "./reminder-banner";
import { ItemsTab } from "./items-tab";
import { MonthTab } from "./month-tab";
import { SettingsTab } from "./settings-tab";
import { YearTab } from "./year-tab";

const TABS: { value: CostTab; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "items", label: "Items" },
  { value: "settings", label: "Settings" },
];

/**
 * COST-1 /<KEY>/costs. The tab, month and year live in the URL, so each tab's data comes
 * with its page (one round trip) and links to a month work (the COST-7 bell entry opens
 * `?month=YYYY-MM`). Radix tabs give the arrow-key navigation; picking a tab navigates.
 */
export function CostsScreen({
  projectKey,
  route,
  thisMonth,
  items,
  entries,
  settings,
  reminder,
  services,
  users,
}: {
  projectKey: string;
  route: CostRoute;
  thisMonth: Month;
  items: CostItemView[];
  entries: CostEntryView[];
  settings: CostSettingsView;
  reminder: CostReminder | null;
  services: CostServiceOption[];
  users: CostUserOption[];
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  // COST-4 "Show run-rate": kept while switching months and tabs.
  const [runRate, setRunRate] = useState(false);

  function go(next: Partial<CostRoute>) {
    startNavigation(() => router.push(costsHref(projectKey, next)));
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" aria-busy={navigating || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Costs</h1>
          <p className="text-sm text-muted-foreground">
            What running Stockkart costs each month (IMR), in {settings.baseCurrency}.
          </p>
        </div>
      </div>

      {reminder && !(route.tab === "month" && route.month === reminder.month) ? (
        <CostReminderBanner projectKey={projectKey} reminder={reminder} />
      ) : null}

      <Tabs
        value={route.tab}
        onValueChange={(value) => {
          const tab = TABS.find((entry) => entry.value === value)?.value;
          if (!tab) return;
          if (tab === "month") go({ tab, month: route.month });
          else if (tab === "year") go({ tab, year: route.year });
          else go({ tab });
        }}
      >
        <TabsList aria-label="Costs views">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="month">
          {route.tab === "month" ? (
            <MonthTab
              projectKey={projectKey}
              month={route.month}
              thisMonth={thisMonth}
              items={items}
              entries={entries}
              settings={settings}
              reminder={reminder}
              runRate={runRate}
              onRunRateChange={setRunRate}
              onMonthChange={(month) => go({ tab: "month", month })}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="year">
          {route.tab === "year" ? (
            <YearTab
              projectKey={projectKey}
              year={route.year}
              thisMonth={thisMonth}
              items={items}
              entries={entries}
              settings={settings}
              runRate={runRate}
              onRunRateChange={setRunRate}
              onYearChange={(year) => go({ tab: "year", year })}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="items">
          {route.tab === "items" ? (
            <ItemsTab projectKey={projectKey} items={items} services={services} />
          ) : null}
        </TabsContent>
        <TabsContent value="settings">
          {route.tab === "settings" ? (
            <SettingsTab projectKey={projectKey} settings={settings} users={users} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
