"use client";

import { Bookmark, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callAction } from "@/features/issue/client-utils";
import {
  type SavedViewItem,
  sameFilter,
  VIEW_NAME_MAX,
  type ViewFilter,
  viewHref,
} from "@/lib/views/saved-views";
import { saveViewAction, updateViewFilterAction } from "@/server/actions/saved-views";

interface ViewControlsProps {
  projectKey: string;
  /** The view the list was opened from (`?view=`), if the user may read it. */
  activeView: SavedViewItem | null;
  /** The list's current filters and sort, canonical (`viewFilterOf`). */
  currentFilter: ViewFilter;
}

/**
 * VW-3 on the issue list: "Save view" names the current URL filters (private, or shared
 * with the team); on an own view whose filters were changed since, "Update view" stores the
 * current ones. Rename, share, reorder and delete live in the sidebar's view menu.
 */
export function ViewControls({ projectKey, activeView, currentFilter }: ViewControlsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const query = new URLSearchParams(currentFilter).toString();
  const changed = activeView !== null && !sameFilter(activeView.filter, currentFilter);

  function update() {
    if (!activeView) return;
    startTransition(async () => {
      const result = await callAction(() =>
        updateViewFilterAction({ viewId: activeView.id, query }),
      );
      if (result !== null) toast.success(`Updated “${activeView.name}”`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {activeView ? (
        <span className="text-sm text-muted-foreground">
          View: <span className="font-medium text-foreground">{activeView.name}</span>
          {activeView.mine ? null : ` (shared by ${activeView.ownerName ?? "someone"})`}
          {changed ? " · filters changed" : null}
        </span>
      ) : null}
      {activeView?.mine && changed ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={update}>
          <RefreshCw aria-hidden="true" />
          Update view
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Bookmark aria-hidden="true" />
        Save view
      </Button>
      <SaveViewDialog
        open={open}
        onOpenChange={setOpen}
        projectKey={projectKey}
        query={query}
        onSaved={(view) => router.replace(viewHref(projectKey, view), { scroll: false })}
      />
    </div>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  projectKey,
  query,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectKey: string;
  query: string;
  onSaved: (view: { id: string; filter: ViewFilter }) => void;
}) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { name: useId(), shared: useId(), error: useId() };

  function submit() {
    if (!name.trim()) {
      setError("Name the view");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveViewAction({ projectKey, name, shared, query });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success(`Saved view “${name.trim()}”`);
        setName("");
        setShared(false);
        onOpenChange(false);
        onSaved({ id: result.data.id, filter: Object.fromEntries(new URLSearchParams(query)) });
      } catch {
        setError("Something went wrong. Reload the page and try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Saves the current filters and sort. It appears in the sidebar under {projectKey}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.name}>Name</Label>
            <Input
              id={ids.name}
              value={name}
              maxLength={VIEW_NAME_MAX}
              autoComplete="off"
              placeholder="Open P0/P1 bugs — inventory-api"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.error : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id={ids.shared}
              type="checkbox"
              className="size-4 accent-primary"
              checked={shared}
              onChange={(event) => setShared(event.target.checked)}
            />
            <Label htmlFor={ids.shared}>Share with the team</Label>
          </div>
          <p
            id={ids.error}
            role="alert"
            aria-live="assertive"
            className="min-h-5 text-sm text-destructive"
          >
            {error}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
