"use client";

import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

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
import { Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import {
  NO_SECRETS_NOTICE,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_ENV_NAME_MAX,
  SERVICE_ENV_NOTES_MAX,
  SERVICE_LINK_KIND_LABELS,
  SERVICE_LINK_KINDS,
  SERVICE_LINK_LABEL_MAX,
  SERVICE_MAX_ENVIRONMENTS,
  SERVICE_MAX_LINKS,
  SERVICE_NAME_MAX,
  SERVICE_NOTES_MAX,
  SERVICE_REPO_MAX,
  SERVICE_RUNTIME_MAX,
  SERVICE_SLUG_MAX,
  type ServiceLinkKind,
} from "@/lib/service-registry/constants";
import { serviceFieldsInput } from "@/lib/service-registry/schemas";
import { servicePath, serviceSlug } from "@/lib/service-registry/slug";
import { type ServiceDetail, type UserOption } from "@/lib/service-registry/views";
import { createServiceAction, updateServiceAction } from "@/server/actions/service-registry";

const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive";

interface EnvRow {
  key: string;
  name: string;
  url: string;
  notes: string;
}

interface LinkRow {
  key: string;
  label: string;
  kind: ServiceLinkKind;
  url: string;
}

let rowCounter = 0;
const rowKey = () => `row-${(rowCounter += 1)}`;

/**
 * SVC-1 create / edit form in a dialog: name, slug (follows the name until edited),
 * description, repo, runtime, owner, repeatable environment and link rows, notes. The
 * same Zod schema as the server validates before sending (secret heuristic and safe URLs
 * included); the server's answer is what counts.
 */
export function ServiceFormDialog({
  open,
  onOpenChange,
  projectKey,
  users,
  service,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectKey: string;
  users: UserOption[];
  /** Absent: create a new service. */
  service?: ServiceDetail;
}) {
  const router = useRouter();
  const [name, setName] = useState(service?.name ?? "");
  const [slug, setSlug] = useState(service?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(service !== undefined);
  const [description, setDescription] = useState(service?.description ?? "");
  const [repo, setRepo] = useState(service?.repo ?? "");
  const [runtime, setRuntime] = useState(service?.runtime ?? "");
  const [ownerId, setOwnerId] = useState<string | null>(service?.ownerId ?? null);
  const [environments, setEnvironments] = useState<EnvRow[]>(
    (service?.environments ?? []).map((env) => ({
      key: rowKey(),
      name: env.name,
      url: env.url ?? "",
      notes: env.notes ?? "",
    })),
  );
  const [links, setLinks] = useState<LinkRow[]>(
    (service?.links ?? []).map((link) => ({ key: rowKey(), ...link })),
  );
  const [notes, setNotes] = useState(service?.notes ?? "");
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [pending, startTransition] = useTransition();
  const base = useId();
  const id = (field: string) => `${base}-${field}`;
  const errorId = `${base}-errors`;

  const fieldError = (path: string) => errors.get(path);
  const invalid = (path: string) => (errors.has(path) ? true : undefined);

  function submit() {
    const fields = {
      name,
      slug: slugEdited ? slug : "",
      description,
      repo,
      runtime,
      ownerId,
      environments: environments.map(({ name: envName, url, notes: envNotes }) => ({
        name: envName,
        url,
        notes: envNotes,
      })),
      links: links.map(({ label, kind, url }) => ({ label, kind, url })),
      notes,
    };
    const parsed = serviceFieldsInput.safeParse(fields);
    if (!parsed.success) {
      const next = new Map<string, string>();
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (!next.has(path)) next.set(path, issue.message);
      }
      setErrors(next);
      return;
    }
    setErrors(new Map());
    startTransition(async () => {
      const saved = await callAction(() =>
        service
          ? updateServiceAction({ serviceId: service.id, ...fields })
          : createServiceAction({ projectKey, ...fields }),
      );
      if (!saved) return;
      onOpenChange(false);
      if (!service || saved.slug !== service.slug) router.push(servicePath(projectKey, saved.slug));
      else router.refresh();
    });
  }

  const errorList = [...errors.values()];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : "New service"}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <ShieldAlert aria-hidden="true" className="size-4 shrink-0 text-amber-600" />
            {NO_SECRETS_NOTICE} Say where things are, not how to log in.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          aria-describedby={errorList.length > 0 ? errorId : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div aria-live="assertive" id={errorId}>
            {errorList.length > 0 ? (
              <ul className="list-disc rounded-md border border-destructive/40 bg-destructive/5 py-2 pr-3 pl-7 text-sm text-destructive">
                {errorList.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={id("name")} error={fieldError("name")}>
              <Input
                id={id("name")}
                autoFocus
                value={name}
                maxLength={SERVICE_NAME_MAX}
                aria-required="true"
                aria-invalid={invalid("name")}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugEdited)
                    setSlug(event.target.value.trim() ? serviceSlug(event.target.value) : "");
                }}
              />
            </Field>
            <Field
              label="Slug"
              htmlFor={id("slug")}
              hint={service ? "Changing it changes the page's URL." : "Filled in from the name."}
              error={fieldError("slug")}
            >
              <Input
                id={id("slug")}
                value={slug}
                maxLength={SERVICE_SLUG_MAX}
                aria-invalid={invalid("slug")}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setSlug(event.target.value);
                  setSlugEdited(event.target.value !== "");
                }}
              />
            </Field>
            <Field label="Repo" htmlFor={id("repo")} hint="Owner/repo" error={fieldError("repo")}>
              <Input
                id={id("repo")}
                value={repo}
                maxLength={SERVICE_REPO_MAX}
                placeholder="Stockkart/inventory-api"
                aria-invalid={invalid("repo")}
                spellCheck={false}
                onChange={(event) => setRepo(event.target.value)}
              />
            </Field>
            <Field label="Runtime / host" htmlFor={id("runtime")} error={fieldError("runtime")}>
              <Input
                id={id("runtime")}
                value={runtime}
                maxLength={SERVICE_RUNTIME_MAX}
                placeholder="DigitalOcean App Platform, Vercel…"
                aria-invalid={invalid("runtime")}
                onChange={(event) => setRuntime(event.target.value)}
              />
            </Field>
            <Field label="Owner" htmlFor={id("owner")} error={fieldError("ownerId")}>
              <Select
                id={id("owner")}
                label="Owner"
                value={ownerId}
                clearLabel="No owner"
                options={users.map((user) => ({
                  value: user.id,
                  label: user.name || user.email,
                  keywords: user.email,
                }))}
                onChange={setOwnerId}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor={id("description")} error={fieldError("description")}>
            <textarea
              id={id("description")}
              rows={2}
              value={description}
              maxLength={SERVICE_DESCRIPTION_MAX}
              aria-invalid={invalid("description")}
              className={textareaClass}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Environments</legend>
            {environments.map((env, index) => (
              <div key={env.key} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
                <Input
                  aria-label={`Environment ${index + 1} name`}
                  placeholder="production"
                  value={env.name}
                  maxLength={SERVICE_ENV_NAME_MAX}
                  aria-invalid={invalid(`environments.${index}.name`)}
                  onChange={(event) =>
                    setEnvironments((rows) =>
                      rows.map((row) =>
                        row.key === env.key ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Environment ${index + 1} URL`}
                  placeholder="https://…"
                  type="url"
                  value={env.url}
                  aria-invalid={invalid(`environments.${index}.url`)}
                  onChange={(event) =>
                    setEnvironments((rows) =>
                      rows.map((row) =>
                        row.key === env.key ? { ...row, url: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Environment ${index + 1} notes`}
                  placeholder="Notes (no secrets)"
                  value={env.notes}
                  maxLength={SERVICE_ENV_NOTES_MAX}
                  aria-invalid={invalid(`environments.${index}.notes`)}
                  onChange={(event) =>
                    setEnvironments((rows) =>
                      rows.map((row) =>
                        row.key === env.key ? { ...row, notes: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove environment ${index + 1}`}
                  onClick={() =>
                    setEnvironments((rows) => rows.filter((row) => row.key !== env.key))
                  }
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={environments.length >= SERVICE_MAX_ENVIRONMENTS}
              onClick={() =>
                setEnvironments((rows) => [
                  ...rows,
                  { key: rowKey(), name: "", url: "", notes: "" },
                ])
              }
            >
              <Plus aria-hidden="true" />
              Add environment
            </Button>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Links</legend>
            {links.map((link, index) => (
              <div key={link.key} className="grid gap-2 sm:grid-cols-[10rem_9rem_1fr_auto]">
                <Input
                  aria-label={`Link ${index + 1} label`}
                  placeholder="Logs"
                  value={link.label}
                  maxLength={SERVICE_LINK_LABEL_MAX}
                  aria-invalid={invalid(`links.${index}.label`)}
                  onChange={(event) =>
                    setLinks((rows) =>
                      rows.map((row) =>
                        row.key === link.key ? { ...row, label: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Select
                  aria-label={`Link ${index + 1} kind`}
                  label={`Link ${index + 1} kind`}
                  value={link.kind}
                  options={SERVICE_LINK_KINDS.map((kind) => ({
                    value: kind,
                    label: SERVICE_LINK_KIND_LABELS[kind],
                  }))}
                  onChange={(kind) => {
                    if (kind)
                      setLinks((rows) =>
                        rows.map((row) => (row.key === link.key ? { ...row, kind } : row)),
                      );
                  }}
                />
                <Input
                  aria-label={`Link ${index + 1} URL`}
                  placeholder="https://…"
                  type="url"
                  value={link.url}
                  aria-invalid={invalid(`links.${index}.url`)}
                  onChange={(event) =>
                    setLinks((rows) =>
                      rows.map((row) =>
                        row.key === link.key ? { ...row, url: event.target.value } : row,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove link ${index + 1}`}
                  onClick={() => setLinks((rows) => rows.filter((row) => row.key !== link.key))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={links.length >= SERVICE_MAX_LINKS}
              onClick={() =>
                setLinks((rows) => [...rows, { key: rowKey(), label: "", kind: "app", url: "" }])
              }
            >
              <Plus aria-hidden="true" />
              Add link
            </Button>
          </fieldset>

          <Field
            label="Notes"
            htmlFor={id("notes")}
            hint={`Plain text. ${NO_SECRETS_NOTICE}`}
            error={fieldError("notes")}
          >
            <textarea
              id={id("notes")}
              rows={4}
              value={notes}
              maxLength={SERVICE_NOTES_MAX}
              aria-invalid={invalid("notes")}
              className={textareaClass}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {service ? "Save" : "Create service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
