"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";

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
import { type ActionResult } from "@/lib/action-result";
import { COMPONENT_NAME_MAX } from "@/lib/settings/constants";
import { githubRepoSchema } from "@/lib/settings/schemas";
import { type ComponentSetting } from "@/lib/settings/views";
import {
  createComponentAction,
  deleteComponentAction,
  renameComponentAction,
  setComponentRepoAction,
} from "@/server/actions/settings";

import { InlineText } from "./inline-text";

type Change =
  | { kind: "add"; component: ComponentSetting }
  | { kind: "rename"; id: string; name: string }
  | { kind: "repo"; id: string; githubRepo: string | null }
  | { kind: "delete"; id: string };

function reduce(list: ComponentSetting[], change: Change): ComponentSetting[] {
  switch (change.kind) {
    case "add":
      return [...list, change.component].sort((a, b) => a.name.localeCompare(b.name));
    case "rename":
      return list.map((c) => (c.id === change.id ? { ...c, name: change.name } : c));
    case "repo":
      return list.map((c) => (c.id === change.id ? { ...c, githubRepo: change.githubRepo } : c));
    case "delete":
      return list.filter((c) => c.id !== change.id);
  }
}

/** The same `Owner/repo` rule as the server (empty is allowed: no repo). */
function checkRepo(value: string): string | null {
  const parsed = githubRepoSchema.safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Use Owner/repo");
}

/**
 * PRJ-2 components: create, rename, map to a GitHub repo (`Owner/repo`) and delete (which
 * unsets it on its issues, recorded in each issue's history). Optimistic with rollback.
 */
export function ComponentEditor({
  projectKey,
  components,
}: {
  projectKey: string;
  components: ComponentSetting[];
}) {
  const [shown, apply] = useOptimistic(components, reduce);
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [deleting, setDeleting] = useState<ComponentSetting | null>(null);
  const titleId = useId();

  function run<T>(change: Change, action: () => Promise<ActionResult<T>>, said: string) {
    startTransition(async () => {
      apply(change);
      const ok = (await callAction(action)) !== null;
      setAnnouncement(ok ? said : "That change was not saved");
    });
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div>
        <h2 id={titleId} className="text-lg font-medium">
          Components
        </h2>
        <p className="text-sm text-muted-foreground">
          Each can map to a GitHub repository, e.g. Stockkart/inventory-api.
        </p>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No components yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((component) => {
            const pending = component.id.startsWith("new:");
            return (
              <li
                key={component.id}
                className="flex flex-wrap items-start gap-2 px-3 py-1.5 text-sm"
              >
                <InlineText
                  label={`Name of component ${component.name}`}
                  value={component.name}
                  maxLength={COMPONENT_NAME_MAX}
                  className="w-48"
                  disabled={pending}
                  validate={(next) => (next ? null : "Name is required")}
                  onCommit={(name) =>
                    run(
                      { kind: "rename", id: component.id, name },
                      () => renameComponentAction({ componentId: component.id, name }),
                      `Renamed to ${name}`,
                    )
                  }
                />
                <InlineText
                  label={`GitHub repository of ${component.name}`}
                  value={component.githubRepo ?? ""}
                  placeholder="Owner/repo"
                  className="w-64"
                  disabled={pending}
                  validate={checkRepo}
                  onCommit={(value) => {
                    const githubRepo = value || null;
                    run(
                      { kind: "repo", id: component.id, githubRepo },
                      () => setComponentRepoAction({ componentId: component.id, githubRepo }),
                      githubRepo ? `${component.name} maps to ${githubRepo}` : "Repository removed",
                    );
                  }}
                />
                <span className="flex-1 pt-1.5 text-xs text-muted-foreground">
                  {component.issueCount} {component.issueCount === 1 ? "issue" : "issues"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={pending}
                  aria-label={`Delete component ${component.name}`}
                  onClick={() => setDeleting(component)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <AddComponentForm
        onAdd={(name, githubRepo) =>
          run(
            {
              kind: "add",
              component: { id: `new:${crypto.randomUUID()}`, name, githubRepo, issueCount: 0 },
            },
            () => createComponentAction({ projectKey, name, githubRepo }),
            `Added ${name}`,
          )
        }
      />
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete component “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting?.issueCount
                ? `${deleting.issueCount} ${deleting.issueCount === 1 ? "issue loses" : "issues lose"} this component; each one’s history records it.`
                : "No issue uses it."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const component = deleting;
                setDeleting(null);
                if (component) {
                  run(
                    { kind: "delete", id: component.id },
                    () => deleteComponentAction({ componentId: component.id }),
                    `Deleted ${component.name}`,
                  );
                }
              }}
            >
              Delete component
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AddComponentForm({ onAdd }: { onAdd: (name: string, githubRepo: string | null) => void }) {
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), repo: useId(), error: useId() };
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.replace(/\s+/g, " ").trim();
        const repoProblem = checkRepo(repo);
        if (!trimmed || repoProblem) {
          setError(repoProblem ?? "Name is required");
          return;
        }
        setError(null);
        onAdd(trimmed, repo.trim() || null);
        setName("");
        setRepo("");
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>New component</Label>
        <Input
          id={ids.name}
          value={name}
          maxLength={COMPONENT_NAME_MAX}
          autoComplete="off"
          placeholder="e.g. mobile-app"
          className="h-8 w-48"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.repo}>GitHub repository (optional)</Label>
        <Input
          id={ids.repo}
          value={repo}
          autoComplete="off"
          placeholder="Owner/repo"
          className="h-8 w-64"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          onChange={(event) => setRepo(event.target.value)}
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={!name.trim()}>
        <Plus aria-hidden="true" />
        Add component
      </Button>
      <p id={ids.error} aria-live="polite" className="basis-full text-sm text-destructive">
        {error}
      </p>
    </form>
  );
}
