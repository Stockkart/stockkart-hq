"use client";

import { type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/settings/constants";

const LABELS: Record<SettingsTab, string> = {
  general: "General",
  workflow: "Workflow",
  views: "Views",
  labels: "Labels",
  components: "Components",
  import: "Import",
  handbook: "Handbook",
};

/**
 * PRJ-3 settings tabs (arrow keys move between tabs, Radix). The open tab is mirrored to
 * `?tab=` with `history.replaceState` (no navigation, no server render), so a reload or a
 * shared link opens the same tab.
 */
export function SettingsTabs({
  initialTab,
  panels,
}: {
  initialTab: SettingsTab;
  panels: Record<SettingsTab, ReactNode>;
}) {
  return (
    <Tabs
      defaultValue={initialTab}
      onValueChange={(value) => {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", value);
        window.history.replaceState(null, "", url);
      }}
    >
      <TabsList aria-label="Project settings">
        {SETTINGS_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {LABELS[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      {SETTINGS_TABS.map((tab) => (
        <TabsContent key={tab} value={tab} className="pt-2">
          {panels[tab]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
