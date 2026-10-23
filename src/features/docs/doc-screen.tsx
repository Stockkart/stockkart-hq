"use client";

import {
  Check,
  FileText,
  History,
  Info,
  Link2,
  MessageSquare,
  Paperclip,
  PanelLeft,
  Pencil,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { shouldIgnoreShortcut } from "@/features/issue/keyboard";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { matchesShortcut } from "@/features/shell/shortcuts";
import { UPLOADS_RUNNING_MESSAGE } from "@/lib/attachments/nodes";
import { anchorIdsInOrder } from "@/lib/doc-comments/anchors";
import { type DocThreadView } from "@/lib/doc-comments/views";
import { adrLabel, formatAdrNumber, splitAdrTitle } from "@/lib/docs/adr";
import { ADR_STATUS_LABELS, DOC_STATUS_LABELS, DOC_TYPE_LABELS } from "@/lib/docs/constants";
import {
  type AdrRef,
  type DocDetail,
  docPath,
  type DocRef,
  type DocTreeItem,
  type DocVersionView,
  type LinkedIssueView,
} from "@/lib/docs/views";
import { type UserOption } from "@/lib/issues/views";
import { emptyDoc, type RichTextDoc } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import { loadDocVersionAction, restoreDocVersionAction } from "@/server/actions/docs";

import { type ConflictInfo, type SaverState } from "./autosaver";
import { DocCommentsPanel } from "./comments/doc-comments-panel";
import { type DocActionContext } from "./doc-actions";
import { DocActionsMenu } from "./doc-actions/doc-actions-menu";
import { ConflictBanner, DocEditor, type DocEditorController, SaveIndicator } from "./doc-editor";
import { DocHeaderBadges } from "./doc-header-badges";
import { DocReadView } from "./doc-read-view";
import { DocDetails, LinkedIssues } from "./doc-side-panel";
import { HistoryPanel, type RestoreOutcome } from "./history/version-history";
import { PagesDrawer, PinnedPages, usePagesPreference } from "./pages-nav";

/**
 * §5.5 doc page (docs UX), for every doc type (ADRs are docs of type `adr`):
 *
 * - Read mode by default: the content through the safe renderer, metadata as quiet chips,
 *   no editor, toolbar or pickers. "Edit" (or `E`) switches to edit mode: editable title,
 *   pickers and the autosaving editor. "Done" (or Esc outside a popover, or ⌘/Ctrl+Enter)
 *   saves what is pending and goes back; a save that did not land asks first. The mode is
 *   `?edit=1` in the URL (links and reloads keep it); new docs open in edit mode.
 * - Room for content: no persistent page tree. A breadcrumb and a "Pages" button (`[`)
 *   open the tree in a drawer; pinning it docks a narrow resizable column instead (per
 *   browser). The side panels (comments, linked issues, attachments, history, details)
 *   open one at a time from the header and are collapsed by default; comments open by
 *   themselves when a thread is focused (anchor click, `#comment-<id>`, a new comment).
 *   Below 1024 px both are overlays.
 * - The header's "⋯" menu and status slot are registries (`doc-actions/`,
 *   `doc-header-badges/`), so the handbook sync slice adds one line each.
 */

export interface DocScreenProps {
  doc: DocDetail;
  ancestors: DocRef[];
  projectKeys: string[];
  users: UserOption[];
  /** Other ADRs of the project, for "Superseded by" (ADR-2). */
  adrs: DocRef[];
  /** ADRs this one supersedes (ADR-3 banner). */
  supersedes: AdrRef[];
  linkedIssues: LinkedIssueView[];
  versions: DocVersionView[];
  /** The project's page tree (the Pages drawer). */
  tree: DocTreeItem[];
  /** ISS-9 attachments panel. */
  attachmentsPanel?: ReactNode;
  /** DOC-11 / DOC-13 comment threads. */
  comments?: { threads: DocThreadView[]; currentUser: { id: string; name: string } };
}

export type DocPanelId = "comments" | "links" | "attachments" | "history" | "details";

const PANELS: { id: DocPanelId; label: string; icon: typeof MessageSquare }[] = [
  { id: "comments", label: "Comments", icon: MessageSquare },
  { id: "links", label: "Linked issues", icon: Link2 },
  { id: "attachments", label: "Attachments", icon: Paperclip },
  { id: "history", label: "History", icon: History },
  { id: "details", label: "Details", icon: Info },
];

/** Where Esc / ⌘↵ belong to something else (menus, pickers, dialogs, the side panel). */
const OWN_KEYS_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-radix-popper-content-wrapper]",
  "[data-doc-side-panel]",
  "[data-pages-nav]",
].join(", ");

export function keysBelongElsewhere(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWN_KEYS_SELECTOR) !== null;
}

/** The read view's copy: the server's, or a newer one saved from this page. */
interface Shown {
  version: number;
  title: string;
  content: RichTextDoc | null;
}

/** `?edit=1` with the rest of the URL kept (the hash too: `#comment-…`). */
function modeUrl(pathname: string, search: string, editing: boolean): string {
  const params = new URLSearchParams(search);
  if (editing) params.set("edit", "1");
  else params.delete("edit");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

export function DocScreen({
  doc,
  ancestors,
  projectKeys,
  users,
  adrs,
  supersedes,
  linkedIssues,
  versions,
  tree,
  attachmentsPanel,
  comments,
}: DocScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlEditing = searchParams.get("edit") === "1";
  // Mirrors the URL; switching updates both without a server round trip (replaceState).
  const [editing, setEditingState] = useState(urlEditing);
  const [seenUrlEditing, setSeenUrlEditing] = useState(urlEditing);
  if (seenUrlEditing !== urlEditing) {
    setSeenUrlEditing(urlEditing);
    setEditingState(urlEditing);
  }
  const [panel, setPanel] = useState<DocPanelId | null>(null);
  const [pagesOpen, setPagesOpen] = useState(false);
  const pages = usePagesPreference();
  const pinnedSearch = useRef<HTMLInputElement>(null);
  const editor = useRef<DocEditorController>(null);
  const [saverState, setSaverState] = useState<SaverState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const [restoreConflict, setRestoreConflict] = useState<{
    version: number;
    latest: ConflictInfo;
  } | null>(null);

  const [shown, setShown] = useState<Shown>({
    version: doc.version,
    title: doc.title,
    content: doc.content,
  });
  // A refresh brought a newer version than the one shown: show the server's.
  if (doc.version > shown.version) {
    setShown({ version: doc.version, title: doc.title, content: doc.content });
  }
  const [editAnchors, setEditAnchors] = useState<string[] | null>(null);
  const anchorOrder = editing && editAnchors ? editAnchors : anchorIdsInOrder(shown.content);

  function setEditing(next: boolean) {
    setEditingState(next);
    setSeenUrlEditing(next);
    if (!next) {
      setSaverState(null);
      setEditAnchors(null);
    }
    window.history.replaceState(null, "", modeUrl(pathname, window.location.search, next));
  }

  /**
   * "Done": save what is pending, then read mode. Resolves with the version now saved, or
   * null if the person chose to stay (a save did not land).
   */
  async function done(): Promise<{ version: number } | null> {
    // Key repeat or a double Esc must not run a second flush (or a second prompt).
    if (leavingRef.current) return null;
    const controller = editor.current;
    let version = shown.version;
    if (controller) {
      // A running upload lands in the editor; leaving now would drop it.
      if (controller.uploading()) {
        toast.error(`${UPLOADS_RUNNING_MESSAGE} before you leave edit mode.`);
        return null;
      }
      leavingRef.current = true;
      setLeaving(true);
      const state = await controller.flush().finally(() => {
        leavingRef.current = false;
      });
      setLeaving(false);
      version = state.version;
      if (state.status === "conflict" || state.status === "error") {
        const leave = window.confirm(
          "Your latest changes are not saved. Leave edit mode anyway? They stay in this tab as a draft you can restore.",
        );
        if (!leave) return null;
      } else {
        const mine = controller.mine();
        setShown({ version: state.version, title: mine.title, content: mine.content });
      }
    }
    setEditing(false);
    router.refresh();
    return { version };
  }

  // The key handlers see this render's state through a ref (registered once).
  const keys = useRef<{
    modEnter: (event: KeyboardEvent) => void;
    other: (event: KeyboardEvent) => void;
  }>(null);
  useEffect(() => {
    keys.current = {
      // Capture phase, so ⌘/Ctrl+Enter is "Done" even inside the editor (whose hard-break
      // binding would take it otherwise); not inside dialogs, menus, pickers or the panel.
      modEnter: (event) => {
        if (!editing || event.defaultPrevented || keysBelongElsewhere(event.target)) return;
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        void done();
      },
      // Bubbling phase: popovers (mention list, pickers) handle their own Esc first.
      other: (event) => {
        if (editing) {
          const esc =
            event.key === "Escape" &&
            !event.isComposing &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey;
          if (esc && !event.defaultPrevented && !keysBelongElsewhere(event.target)) {
            event.preventDefault();
            void done();
            return;
          }
        }
        if (shouldIgnoreShortcut(event)) return;
        if (matchesShortcut(event, "docPages")) {
          event.preventDefault();
          openPages();
        } else if (!editing && matchesShortcut(event, "docEdit")) {
          event.preventDefault();
          setEditing(true);
        }
      },
    };
  });
  useEffect(() => {
    const onCapture = (event: KeyboardEvent) => keys.current?.modEnter(event);
    const onBubble = (event: KeyboardEvent) => keys.current?.other(event);
    document.addEventListener("keydown", onCapture, true);
    document.addEventListener("keydown", onBubble);
    return () => {
      document.removeEventListener("keydown", onCapture, true);
      document.removeEventListener("keydown", onBubble);
    };
  }, []);

  function openPages() {
    // A pinned column is only shown from 1024 px; below that the drawer stays.
    const wide =
      typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches;
    if (pages.pinned && wide) pinnedSearch.current?.focus();
    else setPagesOpen(true);
  }

  /** The latest title and content: the editor's while editing, else the one shown. */
  function current(): { version: number; title: string; content: RichTextDoc | null } {
    const mine = editing ? editor.current?.mine() : null;
    if (mine) return { version: saverState?.version ?? shown.version, ...mine };
    return shown;
  }

  async function restore(version: number, base?: number): Promise<RestoreOutcome> {
    let baseVersion = base ?? shown.version;
    if (base === undefined && editing) {
      // Restore from edit mode: save my edits first, then continue in read mode.
      const left = await done();
      if (!left) return "failed";
      baseVersion = left.version;
    }
    let result;
    try {
      result = await restoreDocVersionAction({ docId: doc.id, version, baseVersion });
    } catch {
      toast.error("Could not restore. Reload the page and try again.");
      return "failed";
    }
    if (!result.ok) {
      toast.error(result.error);
      return "failed";
    }
    if (result.data.status === "conflict") {
      // A newer save than the one shown: never overwritten (the banner offers the choice).
      setRestoreConflict({ version, latest: result.data.latest });
      return "conflict";
    }
    setRestoreConflict(null);
    toast.success(`Restored v${version} as v${result.data.version}`);
    // The action re-rendered the page with the new version; the read view adopts it.
    router.refresh();
    return "restored";
  }

  const actionContext: DocActionContext = {
    doc: { ...doc, title: current().title },
    ancestors,
    supersedes,
    childCount: tree.filter((item) => item.parentId === doc.id).length,
    editing,
    current: () => {
      const latest = current();
      return { title: latest.title, content: latest.content };
    },
    flush: async () => {
      const controller = editing ? editor.current : null;
      if (!controller) return true;
      const state = await controller.flush();
      return state.status === "saved";
    },
    navigate: (href) => router.push(href),
    download: (href) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = "";
      document.body.append(link);
      link.click();
      link.remove();
    },
    copyText,
  };

  const isAdr = doc.type === "adr";
  const successor = doc.adrSupersededBy;
  const crumb = isAdr && doc.adrNumber !== null ? adrLabel(doc.adrNumber) : current().title;
  const owner = users.find((user) => user.id === doc.ownerId)?.name ?? null;
  const threadCount = comments?.threads.filter((thread) => thread.resolvedAt === null).length ?? 0;

  // Opening a panel from its button moves the focus into it (an overlay below 1024 px).
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const focusPanel = useRef(false);
  useEffect(() => {
    if (!focusPanel.current || panel === null) return;
    focusPanel.current = false;
    panelHeading.current?.focus();
  }, [panel]);

  function togglePanel(id: DocPanelId) {
    focusPanel.current = panel !== id;
    setPanel((current) => (current === id ? null : id));
  }

  return (
    <div className="flex gap-6">
      {pages.pinned ? (
        <PinnedPages
          projectKey={doc.projectKey}
          docs={tree}
          width={pages.width}
          onResize={(width) => pages.update({ width })}
          onUnpin={() => pages.update({ pinned: false })}
          searchRef={pinnedSearch}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-center gap-2 border-b pb-2">
          <Button
            size="sm"
            variant="ghost"
            aria-keyshortcuts="["
            aria-expanded={pagesOpen}
            title="Pages ([)"
            onClick={openPages}
            className={cn(pages.pinned && "lg:hidden")}
          >
            <PanelLeft aria-hidden="true" />
            Pages
          </Button>
          <nav aria-label="Breadcrumb" className="min-w-0 text-sm">
            <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
              <li>
                <Link
                  href={`/${doc.projectKey}/docs`}
                  className="hover:text-foreground hover:underline"
                >
                  Docs
                </Link>
              </li>
              {ancestors.map((ancestor) => (
                <li key={ancestor.id} className="flex items-center gap-1">
                  <span aria-hidden="true">›</span>
                  <Link
                    href={docPath(doc.projectKey, ancestor.id)}
                    className="max-w-40 truncate hover:text-foreground hover:underline"
                  >
                    {ancestor.title}
                  </Link>
                </li>
              ))}
              <li className="flex min-w-0 items-center gap-1">
                <span aria-hidden="true">›</span>
                <Link
                  href={docPath(doc.projectKey, doc.id)}
                  aria-current="page"
                  className="max-w-56 truncate text-foreground hover:underline"
                >
                  {crumb}
                </Link>
              </li>
            </ol>
          </nav>
          <DocHeaderBadges doc={doc} />

          <div className="ml-auto flex flex-wrap items-center gap-1">
            {editing ? (
              <>
                {saverState ? (
                  <SaveIndicator state={saverState} onRetry={() => editor.current?.retry()} />
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  title="Keep this as a version in the history"
                  disabled={saverState?.status === "conflict"}
                  onClick={() => editor.current?.saveVersion()}
                >
                  <History aria-hidden="true" />
                  Save version
                </Button>
                <Button
                  size="sm"
                  aria-keyshortcuts="Control+Enter Meta+Enter Escape"
                  title="Done (Esc or ⌘/Ctrl+Enter)"
                  disabled={leaving}
                  onClick={() => void done()}
                >
                  <Check aria-hidden="true" />
                  {leaving ? "Saving…" : "Done"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                aria-keyshortcuts="e"
                title="Edit (E)"
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            )}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {PANELS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={panel === id}
                aria-controls="doc-side-panel"
                aria-label={
                  id === "comments" && threadCount > 0 ? `${label} (${threadCount})` : label
                }
                title={label}
                onClick={() => togglePanel(id)}
                className={cn(
                  "relative rounded-md p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  panel === id && "bg-accent text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {id === "comments" && threadCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground"
                  >
                    {threadCount}
                  </span>
                ) : null}
              </button>
            ))}
            <DocActionsMenu context={actionContext} />
          </div>
        </header>

        {successor ? (
          <div
            role="note"
            className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
          >
            <TriangleAlert aria-hidden="true" className="size-4 text-amber-600" />
            <span>
              Superseded by{" "}
              <Link
                href={docPath(doc.projectKey, successor.id)}
                className="font-medium underline underline-offset-2"
              >
                {adrLabel(splitAdrTitle(successor.title)?.number ?? null)}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                · {splitAdrTitle(successor.title)?.title ?? successor.title}
              </span>
            </span>
          </div>
        ) : null}
        {supersedes.length > 0 ? (
          <p
            role="note"
            className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
          >
            <FileText aria-hidden="true" className="size-4" />
            Supersedes{" "}
            {supersedes.map((old, index) => (
              <span key={old.id}>
                {index > 0 ? ", " : ""}
                <Link
                  href={docPath(doc.projectKey, old.id)}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  {adrLabel(old.adrNumber)}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
        {restoreConflict ? (
          <ConflictBanner
            conflict={restoreConflict.latest}
            message={
              <>
                Not restored: {restoreConflict.latest.updatedByName ?? "someone else"} saved v
                {restoreConflict.latest.version} after the version you were looking at.
              </>
            }
            keepMineLabel={`Restore v${restoreConflict.version} anyway`}
            onReload={() => {
              setRestoreConflict(null);
              router.refresh();
            }}
            onKeepMine={() => void restore(restoreConflict.version, restoreConflict.latest.version)}
            onCopyMine={() => void copyVersionMarkdown(doc, restoreConflict.version)}
          />
        ) : null}

        <div className="mx-auto flex w-full max-w-[72ch] flex-col gap-4">
          {editing ? (
            <DocEditor
              // A different doc is a different editor (fresh autosave state and version).
              key={doc.id}
              doc={{ ...doc, version: shown.version, title: shown.title, content: shown.content }}
              projectKeys={projectKeys}
              users={users}
              adrs={adrs}
              controllerRef={editor}
              onSaverState={setSaverState}
              onAnchorOrder={setEditAnchors}
            />
          ) : (
            <article aria-label={shown.title} className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold">
                {isAdr && doc.adrNumber !== null ? (
                  <>
                    <span className="font-mono text-muted-foreground">
                      {formatAdrNumber(doc.adrNumber)}.
                    </span>{" "}
                    {splitAdrTitle(shown.title)?.title ?? shown.title}
                  </>
                ) : (
                  shown.title
                )}
              </h1>
              <ul aria-label="Details" className="flex flex-wrap gap-1.5 text-xs">
                {isAdr ? (
                  <Chip>
                    {adrLabel(doc.adrNumber)}
                    {doc.adrStatus ? ` · ${ADR_STATUS_LABELS[doc.adrStatus]}` : ""}
                  </Chip>
                ) : (
                  <Chip>{DOC_TYPE_LABELS[doc.type]}</Chip>
                )}
                <Chip>{DOC_STATUS_LABELS[doc.status]}</Chip>
                <Chip>{owner ? `Owner: ${owner}` : "No owner"}</Chip>
                <Chip>
                  Updated <RelativeTime date={doc.updatedAt} />
                  {doc.updatedByName ? ` by ${doc.updatedByName}` : ""}
                </Chip>
              </ul>
              <DocReadView
                docId={doc.id}
                content={shown.content}
                version={shown.version}
                projectKeys={projectKeys}
                onSaved={(saved) => setShown((now) => ({ ...now, ...saved }))}
              />
            </article>
          )}
        </div>
      </div>

      <aside
        id="doc-side-panel"
        data-doc-side-panel=""
        aria-label={PANELS.find((item) => item.id === panel)?.label ?? "Side panel"}
        hidden={panel === null}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
          event.preventDefault();
          setPanel(null);
        }}
        className="fixed inset-y-0 right-0 z-40 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto border-l bg-background p-4 shadow-lg lg:sticky lg:top-6 lg:z-auto lg:max-h-[calc(100dvh-6rem)] lg:w-80 lg:shrink-0 lg:self-start lg:p-0 lg:pl-6 lg:shadow-none"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 ref={panelHeading} tabIndex={-1} className="text-sm font-semibold outline-none">
            {PANELS.find((item) => item.id === panel)?.label}
          </h2>
          <button
            type="button"
            aria-label="Close the side panel"
            onClick={() => setPanel(null)}
            className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        {/* Always mounted: it receives the comment requests of the editor and the read view. */}
        <div hidden={panel !== "comments"}>
          {comments ? (
            <DocCommentsPanel
              docId={doc.id}
              threads={comments.threads}
              anchorOrder={anchorOrder}
              projectKeys={projectKeys}
              currentUser={comments.currentUser}
              visible={panel === "comments"}
              onActivate={() => setPanel("comments")}
            />
          ) : null}
        </div>
        {panel === "links" ? (
          <LinkedIssues docId={doc.id} projectKey={doc.projectKey} links={linkedIssues} />
        ) : null}
        <div hidden={panel !== "attachments"}>{attachmentsPanel}</div>
        {panel === "history" ? (
          <HistoryPanel
            docId={doc.id}
            projectKey={doc.projectKey}
            versions={versions}
            current={current}
            onRestore={(version) => restore(version)}
          />
        ) : null}
        {panel === "details" ? (
          <DocDetails
            createdAt={doc.createdAt}
            updatedAt={doc.updatedAt}
            updatedByName={doc.updatedByName}
          />
        ) : null}
      </aside>

      <PagesDrawer
        open={pagesOpen}
        onOpenChange={setPagesOpen}
        projectKey={doc.projectKey}
        docs={tree}
        onPin={() => {
          pages.update({ pinned: true });
          setPagesOpen(false);
        }}
      />
    </div>
  );
}

/**
 * Clipboard write that keeps the user gesture: with `ClipboardItem` the (pending) text is
 * handed over at once; otherwise it is awaited first (Chromium and Firefox allow that).
 */
async function copyText(text: string | Promise<string>): Promise<void> {
  const clipboard = navigator.clipboard;
  if (typeof ClipboardItem !== "undefined" && typeof clipboard.write === "function") {
    const blob = Promise.resolve(text).then((value) => new Blob([value], { type: "text/plain" }));
    await clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    return;
  }
  await clipboard.writeText(await text);
}

/** "Copy mine" of a restore conflict: the version that was to be restored, as Markdown. */
async function copyVersionMarkdown(doc: DocDetail, version: number) {
  const markdown = (async () => {
    const detail = await callAction(() => loadDocVersionAction({ docId: doc.id, version }));
    if (!detail) throw new Error("not loaded");
    const { richTextToMarkdown } = await import("@/lib/markdown/from-rich-text");
    const body = richTextToMarkdown(detail.content ?? emptyDoc(), { projectKey: doc.projectKey });
    return `# ${detail.title}\n\n${body}`;
  })();
  try {
    await copyText(markdown);
    toast.success(`v${version} is on the clipboard as Markdown`);
  } catch {
    toast.error("Could not copy. Open the version in History and copy from its preview.");
  }
}

function Chip({ children }: { children: ReactNode }) {
  return <li className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{children}</li>;
}
