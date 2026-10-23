import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { SAFE_URL_MAX, safeUrlSchema } from "@/lib/links/safe-url";

import {
  SERVICE_DESCRIPTION_MAX,
  SERVICE_ENV_NAME_MAX,
  SERVICE_ENV_NOTES_MAX,
  SERVICE_LINK_KINDS,
  SERVICE_LINK_LABEL_MAX,
  SERVICE_MAX_ENVIRONMENTS,
  SERVICE_MAX_LINKS,
  SERVICE_NAME_MAX,
  SERVICE_NOTES_MAX,
  SERVICE_REPO_MAX,
  SERVICE_REPO_PATTERN,
  SERVICE_RUNTIME_MAX,
  SERVICE_SLUG_MAX,
  SERVICE_SLUG_PATTERN,
} from "./constants";
import { findSecretInText, findSecretInUrl, secretErrorMessage } from "./secrets";

/**
 * Zod input schemas of the service registry (SVC-1). Isomorphic: the form validates with
 * them as you type, and the server action and the service parse again (only those count).
 *
 * Every text field goes through the secret heuristic (`secrets.ts`) and every URL through
 * it and `safeUrlSchema` (absolute http(s), no `user:password@`, no invisible characters),
 * so nothing that looks like a credential can be stored (SPEC §4.14 "No secrets").
 */

const id = z.uuid();
const projectKey = z.string().regex(PROJECT_KEY_PATTERN);

/** Collapsed-whitespace single-line text, checked for secrets. */
function line(label: string, max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${label} is too long`))
    .superRefine((value, context) => {
      const found = findSecretInText(value);
      if (found) context.addIssue({ code: "custom", message: secretErrorMessage(label, found) });
    });
}

/** Multi-line plain text (notes, description), checked for secrets; "" → null. */
function paragraph(label: string, max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(max, `${label} is too long`))
    .superRefine((value, context) => {
      const found = findSecretInText(value);
      if (found) context.addIssue({ code: "custom", message: secretErrorMessage(label, found) });
    })
    .transform((value) => (value === "" ? null : value));
}

/** A stored URL: the secret check first (clearer message), then `safeUrlSchema`. */
export function registryUrl(label: string) {
  return z
    .string()
    .trim()
    .max(SAFE_URL_MAX, `${label} is too long`)
    .superRefine((value, context) => {
      const found = findSecretInUrl(value);
      if (found) context.addIssue({ code: "custom", message: secretErrorMessage(label, found) });
    })
    .pipe(safeUrlSchema);
}

const optionalUrl = (label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(registryUrl(label).optional());

export const serviceEnvironmentInput = z.object({
  name: line("Environment name", SERVICE_ENV_NAME_MAX).pipe(
    z.string().min(1, "Every environment needs a name"),
  ),
  url: optionalUrl("Environment URL").optional(),
  notes: paragraph("Environment notes", SERVICE_ENV_NOTES_MAX)
    .optional()
    .transform((value) => value ?? undefined),
});

export const serviceLinkInput = z.object({
  label: line("Link label", SERVICE_LINK_LABEL_MAX).pipe(
    z.string().min(1, "Every link needs a label"),
  ),
  kind: z.enum(SERVICE_LINK_KINDS),
  url: registryUrl("Link URL"),
});

/** `Owner/repo`; "" → null. */
const repo = z
  .string()
  .trim()
  .max(SERVICE_REPO_MAX, "Repo is too long")
  .superRefine((value, context) => {
    const found = findSecretInText(value);
    if (found) context.addIssue({ code: "custom", message: secretErrorMessage("Repo", found) });
  })
  .transform((value) => (value === "" ? null : value))
  .pipe(
    z
      .string()
      .regex(SERVICE_REPO_PATTERN, "Repo must look like Owner/repo, e.g. Stockkart/inventory-api")
      .nullable(),
  );

/** An explicit slug; "" or absent → derived from the name (create) or kept (edit). */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(
    z
      .string()
      .max(SERVICE_SLUG_MAX, "Slug is too long")
      .regex(SERVICE_SLUG_PATTERN, "Slug: lowercase letters, digits and single hyphens")
      .optional(),
  );

export const serviceFieldsInput = z.object({
  name: line("Name", SERVICE_NAME_MAX).pipe(z.string().min(1, "Name is required")),
  slug: slug.optional(),
  description: paragraph("Description", SERVICE_DESCRIPTION_MAX).default(null),
  repo: repo.default(null),
  runtime: line("Runtime", SERVICE_RUNTIME_MAX)
    .transform((value) => (value === "" ? null : value))
    .default(null),
  ownerId: id.nullable().default(null),
  environments: z
    .array(serviceEnvironmentInput)
    .max(SERVICE_MAX_ENVIRONMENTS, `At most ${SERVICE_MAX_ENVIRONMENTS} environments`)
    .default([]),
  links: z
    .array(serviceLinkInput)
    .max(SERVICE_MAX_LINKS, `At most ${SERVICE_MAX_LINKS} links`)
    .default([]),
  notes: paragraph("Notes", SERVICE_NOTES_MAX).default(null),
});
export type ServiceFieldsInput = z.input<typeof serviceFieldsInput>;
export type ServiceFields = z.output<typeof serviceFieldsInput>;

export const createServiceInput = serviceFieldsInput.extend({ projectKey });
export const updateServiceInput = serviceFieldsInput.extend({ serviceId: id });

export const serviceIdInput = z.object({ serviceId: id });
export const addDefaultServicesInput = z.object({ projectKey });

/** Services per project are few; this only bounds the index a client may send. */
const MAX_INDEX = 10_000;
export const moveServiceInput = z.object({
  serviceId: id,
  index: z.number().int().min(0).max(MAX_INDEX),
});

/** "Linked" on the service page: an issue (by key) or a doc (picked by title). */
export const linkServiceInput = z.discriminatedUnion("target", [
  z.object({
    serviceId: id,
    target: z.literal("issue"),
    issueKey: z.string().trim().toUpperCase().max(20),
  }),
  z.object({ serviceId: id, target: z.literal("doc"), docId: id }),
]);
export const unlinkServiceInput = z.object({ serviceId: id, linkId: id });

export const serviceDocSearchInput = z.object({
  projectKey,
  q: z.string().max(200).default(""),
});
