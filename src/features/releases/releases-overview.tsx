"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useOptimistic } from "react";

import { type ReleaseSummary } from "@/lib/releases/views";

import { CreateReleaseButton, ReleaseActions } from "./release-actions";
import { releaseDateLine, ReleaseProgress } from "./release-progress";
import { applyReleaseChange } from "./release-state";

/**
 * REL-1 release list: unreleased releases first (by target date), then released ones
 * (newest first). Every change is optimistic (see `ReleaseChange`).
 */
export function ReleasesOverview({
  projectKey,
  releases,
}: {
  projectKey: string;
  releases: ReleaseSummary[];
}) {
  const [shown, applyChange] = useOptimistic(releases, applyReleaseChange);
  const unreleased = shown.filter((release) => release.state === "unreleased");
  const released = shown.filter((release) => release.state === "released");

  const section = (id: string, title: string, items: ReleaseSummary[], empty: string) => (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((release) => (
            <li key={release.id}>
              <ReleaseCard projectKey={projectKey} release={release}>
                <ReleaseActions
                  projectKey={projectKey}
                  release={release}
                  releases={shown}
                  onChange={applyChange}
                />
              </ReleaseCard>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Releases</h1>
        <CreateReleaseButton projectKey={projectKey} onChange={applyChange} />
      </div>
      {section(
        "releases-unreleased",
        "Unreleased",
        unreleased,
        "No unreleased releases. Create one, then set it as the fix version of issues.",
      )}
      {section("releases-released", "Released", released, "Nothing released yet.")}
    </div>
  );
}

function ReleaseCard({
  projectKey,
  release,
  children,
}: {
  projectKey: string;
  release: ReleaseSummary;
  children?: React.ReactNode;
}) {
  const pending = release.id.startsWith("new:");
  return (
    <article
      aria-label={release.name}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="font-medium">
          {pending ? (
            release.name
          ) : (
            <Link
              href={`/${projectKey}/releases/${release.id}`}
              className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {release.name}
            </Link>
          )}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {releaseDateLine(release)}
          </span>
        </h3>
        {release.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{release.description}</p>
        ) : null}
        {release.notesDocId ? (
          <Link
            href={`/${projectKey}/docs/${release.notesDocId}`}
            className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <FileText aria-hidden="true" className="size-3" />
            Release notes<span className="sr-only"> for {release.name}</span>
          </Link>
        ) : null}
      </div>
      <ReleaseProgress release={release} />
      {children}
    </article>
  );
}
