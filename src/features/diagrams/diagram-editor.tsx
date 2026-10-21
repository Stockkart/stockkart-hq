"use client";

import { ChevronDown, Download, FileCode2, History, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Autosaver,
  type SaveRequest,
  type SaveResponse,
  type SaverState,
} from "@/features/docs/autosaver";
import { ConflictBanner, SaveIndicator } from "@/features/docs/doc-editor";
import { callAction } from "@/features/issue/client-utils";
import {
  DIAGRAM_KIND_LABELS,
  DIAGRAM_TITLE_MAX,
  SCENE_TOO_LARGE_MESSAGE,
  THUMBNAIL_MAX_WIDTH,
} from "@/lib/diagrams/constants";
import { diagramsPath, nodeLinkPath } from "@/lib/diagrams/links";
import { flowToMermaid } from "@/lib/diagrams/mermaid";
import {
  type DiagramScene,
  flowSceneSchema,
  isWhiteboardScene,
  sceneFits,
} from "@/lib/diagrams/scene";
import {
  type DiagramDetail,
  type DiagramLinkView,
  type DiagramVersionScene,
  type DiagramVersionView,
} from "@/lib/diagrams/views";
import {
  confirmThumbnailAction,
  loadDiagramVersionAction,
  requestThumbnailUploadAction,
  restoreDiagramVersionAction,
  saveDiagramAction,
} from "@/server/actions/diagrams";

import { DiagramSidePanel } from "./diagram-side-panel";
import { DiagramKindIcon } from "./diagram-thumbnail";
import { LazyFlowCanvas, LazyWhiteboardCanvas } from "./lazy-canvases";
import { diagramPng, diagramSvg, downloadBlob, exportFilename } from "./render";
import { ThumbnailUploader } from "./thumbnail";
import { useDarkMode } from "./use-dark-mode";

type Saver = Autosaver<DiagramScene>;

async function saveRequest(
  diagramId: string,
  request: SaveRequest<DiagramScene>,
): Promise<SaveResponse<DiagramScene>> {
  // Checked here too, so an oversized scene gets the message without a round trip.
  if (!sceneFits(request.content)) return { status: "failed", message: SCENE_TOO_LARGE_MESSAGE };
  let result;
  try {
    result = await saveDiagramAction({
      diagramId,
      baseVersion: request.baseVersion,
      title: request.title,
      scene: request.content,
      snapshot: request.snapshot,
    });
  } catch {
    return { status: "failed", message: "Could not save. Reload the page and try again." };
  }
  if (!result.ok) return { status: "failed", message: result.error };
  const data = result.data;
  if (data.status === "saved") {
    return { status: "saved", version: data.version, snapshotted: data.snapshotted };
  }
  return {
    status: "conflict",
    latest: {
      version: data.latest.version,
      title: data.latest.title,
      content: data.latest.scene,
      updatedByName: data.latest.updatedByName,
    },
  };
}

/**
 * §5.6 diagram editor shell, shared by both kinds: title, "Saved · vN", ~2 s autosave with
 * optimistic locking and the docs' conflict banner (§7.4, DGM-4), "Save version", history
 * with read-only preview and restore, Export (DGM-6), the Linked panel, and the thumbnail
 * upload (DGM-5).
 */
export function DiagramEditor({
  diagram,
  versions,
  links,
}: {
  diagram: DiagramDetail;
  versions: DiagramVersionView[];
  links: DiagramLinkView[];
}) {
  const router = useRouter();
  const dark = useDarkMode();
  const titleId = useId();
  const [titleText, setTitleText] = useState(diagram.title);
  const [state, setState] = useState<SaverState<DiagramScene>>({
    status: "saved",
    version: diagram.version,
    conflict: null,
    error: null,
  });
  /** Bumped to remount the canvas with the saver's content (reload, restore, preview end). */
  const [canvasKey, setCanvasKey] = useState(0);
  const [preview, setPreview] = useState<DiagramVersionScene | null>(null);

  // Created once per diagram: the saver owns the version and the pending scene from here
  // on; the thumbnail uploader draws the saver's current copy (also while unmounting).
  const [{ saver, thumbnails }] = useState(() => {
    const holder: { saver?: Saver } = {};
    const uploader = new ThumbnailUploader(diagram.id, {
      render: () =>
        diagramPng(diagram.kind, holder.saver?.mine.content ?? diagram.scene, THUMBNAIL_MAX_WIDTH),
      request: requestThumbnailUploadAction,
      confirm: confirmThumbnailAction,
      put: (url, init) => fetch(url, init),
    });
    holder.saver = new Autosaver<DiagramScene>(
      { version: diagram.version, content: diagram.scene, title: diagram.title },
      {
        save: (request) => saveRequest(diagram.id, request),
        onState: setState,
        onSaved: ({ titleChanged, snapshotted }) => {
          void uploader.maybeUpload();
          // The title (breadcrumb, list) or the history changed: re-render the page.
          if (titleChanged || snapshotted) router.refresh();
        },
      },
    );
    return { saver: holder.saver, thumbnails: uploader };
  });

  useEffect(() => {
    // No thumbnail yet (e.g. made from a template): draw one on the first save.
    if (!diagram.hasThumbnail) thumbnails.markChanged();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saver.hasUnsavedChanges) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Leaving the page (client navigation): save what is pending, refresh the thumbnail.
      saver.saveNow();
      void thumbnails.maybeUpload({ force: true });
      saver.dispose();
    };
  }, [saver, thumbnails, diagram.hasThumbnail]);

  // A refresh brought a newer version (e.g. renamed from the list). Continue from it only if
  // it holds exactly my scene; otherwise the next save reports the conflict.
  const [seenVersion, setSeenVersion] = useState(diagram.version);
  if (seenVersion !== diagram.version) {
    setSeenVersion(diagram.version);
    const adopted = saver.rebase({
      version: diagram.version,
      title: diagram.title,
      content: diagram.scene,
    });
    if (adopted !== null) setTitleText(adopted);
  }

  function onSceneChange(scene: DiagramScene) {
    thumbnails.markChanged();
    saver.change({ content: scene });
  }

  function reload() {
    const latest = saver.reload();
    if (!latest) return;
    setTitleText(latest.title);
    setCanvasKey((key) => key + 1);
    router.refresh();
  }

  async function copyMine() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(saver.mine.content));
      toast.success("Your version (scene JSON) is on the clipboard");
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  }

  async function openPreview(version: number) {
    const loaded = await callAction(() =>
      loadDiagramVersionAction({ diagramId: diagram.id, version }),
    );
    if (loaded) setPreview(loaded);
  }

  function closePreview() {
    setPreview(null);
    setCanvasKey((key) => key + 1);
  }

  async function restore(version: number) {
    if (!window.confirm(`Restore v${version}? It becomes a new version; nothing is lost.`)) return;
    const result = await callAction(() =>
      restoreDiagramVersionAction({
        diagramId: diagram.id,
        version,
        baseVersion: saver.current.version,
      }),
    );
    if (!result) return;
    if (result.status === "conflict") {
      toast.error(
        `${result.latest.updatedByName ?? "Someone"} saved v${result.latest.version} meanwhile. Reload, then restore again.`,
      );
      return;
    }
    const restored = await callAction(() =>
      loadDiagramVersionAction({ diagramId: diagram.id, version }),
    );
    const adopted =
      restored !== null &&
      saver.adopt({ version: result.version, content: restored.scene, title: saver.mine.title });
    setPreview(null);
    if (adopted) {
      setCanvasKey((key) => key + 1);
      thumbnails.markChanged();
      void thumbnails.maybeUpload({ force: true });
      toast.success(`Restored v${version} as v${result.version}`);
    } else {
      // Something changed meanwhile: load the page fresh rather than guess.
      window.location.reload();
    }
  }

  async function exportAs(format: "png" | "svg") {
    try {
      const scene = saver.mine.content;
      const blob =
        format === "png"
          ? await diagramPng(diagram.kind, scene)
          : new Blob([await diagramSvg(diagram.kind, scene)], { type: "image/svg+xml" });
      downloadBlob(blob, exportFilename(saver.mine.title, format));
    } catch {
      toast.error("The export failed. Try again.");
    }
  }

  async function copyMermaid() {
    const parsed = flowSceneSchema.safeParse(saver.mine.content);
    if (!parsed.success) return;
    try {
      await navigator.clipboard.writeText(flowToMermaid(parsed.data));
      toast.success("Mermaid flowchart copied; paste it into a doc’s Mermaid block");
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  }

  const openPath = (path: string) => router.push(path);
  const readOnly = preview !== null;
  // What a (re)mounted canvas starts from; canvases read it once, on mount.
  const canvasScene = useMemo(
    () => (preview ? preview.scene : saver.mine.content),
    // `canvasKey` is the remount signal: the saver's copy is read again only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, canvasKey, saver],
  );
  const canvasId = preview ? `preview-${preview.version}` : `edit-${canvasKey}`;
  const canvas = isWhiteboardScene(canvasScene) ? (
    <LazyWhiteboardCanvas
      key={canvasId}
      scene={canvasScene}
      onChange={readOnly ? undefined : onSceneChange}
      readOnly={readOnly}
      dark={dark}
      onNavigate={openPath}
    />
  ) : (
    <LazyFlowCanvas
      key={canvasId}
      scene={canvasScene}
      onChange={readOnly ? undefined : onSceneChange}
      readOnly={readOnly}
      dark={dark}
      projectKey={diagram.projectKey}
      onOpenLink={(link) => openPath(nodeLinkPath(link, diagram.projectKey))}
    />
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <nav aria-label="Breadcrumb" className="shrink-0 text-sm text-muted-foreground">
              <Link
                href={diagramsPath(diagram.projectKey)}
                className="hover:text-foreground hover:underline"
              >
                Diagrams
              </Link>
              <span aria-hidden="true"> ▸</span>
            </nav>
            <label htmlFor={titleId} className="sr-only">
              Title
            </label>
            <input
              id={titleId}
              value={titleText}
              maxLength={DIAGRAM_TITLE_MAX}
              onChange={(event) => {
                setTitleText(event.target.value);
                const next = event.target.value.replace(/\s+/g, " ").trim();
                // An empty title is not saved; the last saved one stays until it is filled in.
                if (next) saver.change({ title: next });
              }}
              className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-xl font-semibold outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <span className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
              <DiagramKindIcon kind={diagram.kind} className="size-3" />
              {DIAGRAM_KIND_LABELS[diagram.kind]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SaveIndicator state={state} onRetry={() => saver.saveNow()} />
            <Button
              size="sm"
              variant="outline"
              title="Keep this as a version in the history"
              disabled={state.status === "conflict" || readOnly}
              onClick={() => saver.saveNow(true)}
            >
              <History aria-hidden="true" />
              Save version
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Download aria-hidden="true" />
                  Export
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportAs("png")}>
                  Download PNG
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportAs("svg")}>
                  Download SVG
                </DropdownMenuItem>
                {diagram.kind === "flow" ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void copyMermaid()}>
                      <FileCode2 aria-hidden="true" />
                      Copy as Mermaid flowchart
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {state.conflict ? (
          <ConflictBanner
            conflict={state.conflict}
            onReload={reload}
            onKeepMine={() => saver.keepMine()}
            onCopyMine={() => void copyMine()}
          />
        ) : null}
        {state.status === "error" && state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
        {preview ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-sm"
          >
            <span className="flex-1">
              Previewing v{preview.version} (read-only). Your current diagram is unchanged.
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={state.status !== "saved"}
              onClick={() => void restore(preview.version)}
            >
              Restore this version
            </Button>
            <Button size="sm" variant="ghost" onClick={closePreview}>
              <X aria-hidden="true" />
              Back to editing
            </Button>
          </div>
        ) : null}

        <div className="h-[72vh] min-h-96 overflow-hidden rounded-lg border">{canvas}</div>
      </div>

      <DiagramSidePanel
        diagramId={diagram.id}
        projectKey={diagram.projectKey}
        links={links}
        versions={versions}
        currentVersion={state.version}
        canRestore={state.status === "saved"}
        onPreview={(version) => void openPreview(version)}
        onRestore={(version) => void restore(version)}
      />
    </div>
  );
}
