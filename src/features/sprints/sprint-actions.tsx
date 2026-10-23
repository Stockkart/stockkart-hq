"use client";

import { EllipsisVertical, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { callAction } from "@/features/issue/client-utils";
import { type SprintSummary } from "@/lib/sprints/views";
import {
  completeSprintAction,
  createSprintAction,
  deleteSprintAction,
  startSprintAction,
  updateSprintAction,
} from "@/server/actions/sprints";

import {
  CompleteSprintDialog,
  DeleteSprintDialog,
  SprintFormDialog,
  StartSprintDialog,
} from "./sprint-dialogs";
import { nextPlanned, type SprintChange } from "./sprint-state";

/** What the sprint controls need to know about the project. */
export interface SprintContext {
  projectKey: string;
  sprintLengthDays: number;
  /** Every sprint of the project (optimistic copy), for "next planned" and the active one. */
  sprints: readonly SprintSummary[];
  /** "Sprint N" for a sprint created now (N = sprints so far + 1). */
  newSprintName: string;
}

type Dialog = "start" | "complete" | "edit" | "delete" | null;

/**
 * Start / Complete / Edit / Delete for one sprint, with their dialogs. Each confirmed action
 * applies `onChange` optimistically inside the transition that runs the server action (see
 * `SprintChange`), so the list updates at once and rolls back if the server refuses.
 */
export function SprintActions({
  sprint,
  context,
  onChange,
}: {
  sprint: SprintSummary;
  context: SprintContext;
  onChange: (change: SprintChange) => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();
  const active = context.sprints.find(
    (other) => other.state === "active" && other.id !== sprint.id,
  );
  const next = nextPlanned(context.sprints, sprint.id);
  const openChange = (which: Exclude<Dialog, null>) => (open: boolean) =>
    setDialog(open ? which : null);

  function run<T>(change: SprintChange, action: () => Promise<T | null>, done: string) {
    setDialog(null);
    startTransition(async () => {
      onChange(change);
      const result = await action();
      if (result !== null) toast.success(done);
    });
  }

  // Closed sprints take no actions; a sprint still being created has no id yet.
  if (sprint.state === "closed" || sprint.id.startsWith("new:")) return null;
  const label = `for ${sprint.name}`;

  return (
    <div className="flex items-center gap-1">
      {sprint.state === "planned" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Start ${sprint.name}`}
          onClick={() => setDialog("start")}
        >
          Start
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Complete ${sprint.name}`}
          onClick={() => setDialog("complete")}
        >
          Complete
        </Button>
      )}
      {sprint.state === "planned" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`More ${label}`}>
              <EllipsisVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog("edit")}>Edit…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("delete")}>Delete…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <StartSprintDialog
        open={dialog === "start"}
        onOpenChange={openChange("start")}
        sprint={sprint}
        activeSprintName={active?.name ?? null}
        onConfirm={() =>
          run(
            { kind: "start", id: sprint.id },
            () => callAction(() => startSprintAction({ sprintId: sprint.id })),
            `${sprint.name} started`,
          )
        }
      />
      <CompleteSprintDialog
        open={dialog === "complete"}
        onOpenChange={openChange("complete")}
        sprint={sprint}
        nextSprintName={next?.name ?? null}
        newSprintName={context.newSprintName}
        onConfirm={(carryTo) =>
          run(
            { kind: "complete", id: sprint.id, carryTo, targetId: next?.id ?? null },
            () => callAction(() => completeSprintAction({ sprintId: sprint.id, carryTo })),
            `${sprint.name} completed`,
          )
        }
      />
      {sprint.state === "planned" ? (
        <>
          <SprintFormDialog
            open={dialog === "edit"}
            onOpenChange={openChange("edit")}
            mode="edit"
            sprintLengthDays={context.sprintLengthDays}
            initial={{
              name: sprint.name,
              goal: sprint.goal,
              startDate: sprint.startDate ?? "",
              endDate: sprint.endDate ?? "",
            }}
            onConfirm={(values) =>
              run(
                { kind: "update", id: sprint.id, fields: values },
                () => callAction(() => updateSprintAction({ sprintId: sprint.id, ...values })),
                `${values.name} saved`,
              )
            }
          />
          <DeleteSprintDialog
            open={dialog === "delete"}
            onOpenChange={openChange("delete")}
            sprint={sprint}
            onConfirm={() =>
              run(
                { kind: "remove", id: sprint.id },
                () => callAction(() => deleteSprintAction({ sprintId: sprint.id })),
                `${sprint.name} deleted`,
              )
            }
          />
        </>
      ) : null}
    </div>
  );
}

/** SPR-1 "Create sprint" with the defaults (name, dates) worked out by the page. */
export function CreateSprintButton({
  context,
  defaults,
  onChange,
}: {
  context: SprintContext;
  defaults: { name: string; startDate: string; endDate: string };
  onChange: (change: SprintChange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="sm" disabled={pending} onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Create sprint
      </Button>
      <SprintFormDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        sprintLengthDays={context.sprintLengthDays}
        initial={{ ...defaults, goal: null }}
        onConfirm={(values) => {
          setOpen(false);
          startTransition(async () => {
            onChange({
              kind: "add",
              sprint: {
                id: `new:${values.name}`,
                ...values,
                state: "planned",
                closedAt: null,
                open: { count: 0, points: 0 },
                done: { count: 0, points: 0 },
                wontDo: { count: 0, points: 0 },
                retroDocId: null,
              },
            });
            const result = await callAction(() =>
              createSprintAction({ projectKey: context.projectKey, ...values }),
            );
            if (result) toast.success(`${values.name} created`);
          });
        }}
      />
    </>
  );
}
