"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { userOptions } from "@/features/issue/field-options";
import { type UserOption } from "@/lib/issues/views";
import { PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX } from "@/lib/settings/constants";
import { updateProjectInput } from "@/lib/settings/schemas";
import { type ProjectGeneral } from "@/lib/settings/views";
import { SPRINT_MAX_DAYS } from "@/lib/sprints/constants";
import { updateProjectSettingsAction } from "@/server/actions/settings";

/**
 * PRJ-3 General: name, description, lead, default assignee (quick create uses it when no
 * assignee is given) and the default sprint length. One form, one save; the same Zod schema
 * as the server gives the first error before the request.
 */
export function GeneralForm({ project, users }: { project: ProjectGeneral; users: UserOption[] }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [leadId, setLeadId] = useState(project.leadId);
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(project.defaultAssigneeId);
  const [sprintLength, setSprintLength] = useState(String(project.sprintLengthDays));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = {
    name: useId(),
    description: useId(),
    lead: useId(),
    assignee: useId(),
    sprint: useId(),
    sprintHint: useId(),
    assigneeHint: useId(),
    error: useId(),
  };
  const options = userOptions(users);

  function submit() {
    const input = {
      projectKey: project.key,
      name,
      description,
      leadId,
      defaultAssigneeId,
      sprintLengthDays: Number(sprintLength),
    };
    const parsed = updateProjectInput.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProjectSettingsAction(input);
        if (result.ok) toast.success("Project settings saved");
        else setError(result.error);
      } catch {
        setError("Something went wrong. Reload the page and try again.");
      }
    });
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>Name</Label>
        <Input
          id={ids.name}
          value={name}
          maxLength={PROJECT_NAME_MAX}
          aria-required="true"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.description}>Description</Label>
        <textarea
          id={ids.description}
          value={description}
          maxLength={PROJECT_DESCRIPTION_MAX}
          rows={3}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-52 flex-col gap-1.5">
          <Label htmlFor={ids.lead}>Lead</Label>
          <Select
            id={ids.lead}
            label="Lead"
            value={leadId}
            options={options}
            clearLabel="No lead"
            onChange={setLeadId}
          />
        </div>
        <div className="flex min-w-52 flex-col gap-1.5">
          <Label htmlFor={ids.assignee}>Default assignee</Label>
          <Select
            id={ids.assignee}
            label="Default assignee"
            aria-describedby={ids.assigneeHint}
            value={defaultAssigneeId}
            options={options}
            clearLabel="Unassigned"
            onChange={setDefaultAssigneeId}
          />
          <p id={ids.assigneeHint} className="text-xs text-muted-foreground">
            New issues created without an assignee go to this person.
          </p>
        </div>
      </div>
      <div className="flex max-w-40 flex-col gap-1.5">
        <Label htmlFor={ids.sprint}>Sprint length (days)</Label>
        <Input
          id={ids.sprint}
          type="number"
          inputMode="numeric"
          min={1}
          max={SPRINT_MAX_DAYS}
          value={sprintLength}
          aria-describedby={ids.sprintHint}
          onChange={(event) => setSprintLength(event.target.value)}
        />
        <p id={ids.sprintHint} className="text-xs text-muted-foreground">
          The default for new sprints.
        </p>
      </div>
      <p
        id={ids.error}
        role="alert"
        aria-live="assertive"
        className="min-h-5 text-sm text-destructive"
      >
        {error}
      </p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
