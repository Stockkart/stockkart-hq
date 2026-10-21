import type { Metadata } from "next";
import Link from "next/link";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { TrashList } from "@/features/trash/trash-list";
import { TRASH_DAYS, type TrashItem } from "@/lib/trash/views";
import { requirePageSession } from "@/server/auth/require-session";
import { trashService } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Trash · ${projectKey.toUpperCase()}` };
}

/** ISS-13: deleted issues and docs of the last 30 days, restorable. One round trip. */
export default async function TrashPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const key = resolveProjectKey(projectKey, "/trash");
  const [project, trash] = await Promise.all([
    requireProject(key),
    trashService.listTrash(projectIdByKey(key)),
  ]);
  const items: TrashItem[] = [...trash.issues, ...trash.docs].sort(
    (a, b) => b.deletedAt.getTime() - a.deletedAt.getTime(),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Trash · {project.key}</h1>
        <Link
          href={`/${project.key}/settings`}
          className="rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Project settings
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Issues and docs deleted in the last {TRASH_DAYS} days. Older ones are hidden here but kept.
      </p>
      <TrashList projectKey={project.key} items={items} />
    </div>
  );
}
