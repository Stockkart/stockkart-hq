"use client";

import { Shapes, Workflow } from "lucide-react";
import { useState } from "react";

import { type DiagramKind } from "@/lib/diagrams/constants";
import { diagramThumbnailPath } from "@/lib/diagrams/links";
import { cn } from "@/lib/utils";

export function DiagramKindIcon({ kind, className }: { kind: DiagramKind; className?: string }) {
  const Icon = kind === "flow" ? Workflow : Shapes;
  return <Icon aria-hidden="true" className={className} />;
}

/**
 * DGM-5 thumbnail through the authed file route (302 to a short-lived signed R2 URL). Shows
 * the kind icon instead when there is none (storage not set up, never saved, or the route
 * answers 404/503).
 */
export function DiagramThumbnail({
  diagramId,
  kind,
  hasThumbnail = true,
  cacheKey,
  className,
}: {
  diagramId: string;
  kind: DiagramKind | null;
  hasThumbnail?: boolean;
  /** Changes when the diagram was saved again, so a cached image is not reused. */
  cacheKey?: string | number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const frame = cn(
    "flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-md border bg-muted/40",
    className,
  );
  if (!hasThumbnail || failed) {
    return (
      <div className={frame}>
        {kind ? (
          <DiagramKindIcon kind={kind} className="size-8 text-muted-foreground" />
        ) : (
          <Shapes aria-hidden="true" className="size-8 text-muted-foreground" />
        )}
      </div>
    );
  }
  return (
    <div className={frame}>
      {/* A plain img: the authed route redirects to a signed URL that next/image's
          optimizer could not fetch (it has no session). Decorative; the title is beside it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={diagramThumbnailPath(diagramId, cacheKey)}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
