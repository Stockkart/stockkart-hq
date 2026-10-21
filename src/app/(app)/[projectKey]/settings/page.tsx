import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { ComponentEditor } from "@/features/settings/project/component-editor";
import { GeneralForm } from "@/features/settings/project/general-form";
import { LabelEditor } from "@/features/settings/project/label-editor";
import { SettingsTabs } from "@/features/settings/project/settings-tabs";
import { WorkflowEditor } from "@/features/settings/project/workflow-editor";
import { SETTINGS_TABS } from "@/lib/settings/constants";
import { requirePageSession } from "@/server/auth/require-session";
import { settingsQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Project settings · ${projectKey.toUpperCase()}` };
}

/** PRJ-2/PRJ-3 project settings: General, Workflow, Labels, Components. One round trip. */
export default async function ProjectSettingsPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const raw = await searchParams;
  const tab = z.enum(SETTINGS_TABS).catch("general").parse(raw.tab);
  const key = resolveProjectKey(projectKey, `/settings${tab === "general" ? "" : `?tab=${tab}`}`);
  const [project, settings] = await Promise.all([
    requireProject(key),
    settingsQueries.getSettings(projectIdByKey(key)),
  ]);
  if (!settings) notFound();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Project settings · {project.key}</h1>
        <Link
          href={`/${project.key}/trash`}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Trash
        </Link>
      </div>
      <SettingsTabs
        initialTab={tab}
        panels={{
          general: <GeneralForm project={settings.project} users={settings.users} />,
          workflow: <WorkflowEditor projectKey={project.key} statuses={settings.statuses} />,
          labels: <LabelEditor projectKey={project.key} labels={settings.labels} />,
          components: <ComponentEditor projectKey={project.key} components={settings.components} />,
        }}
      />
    </div>
  );
}
