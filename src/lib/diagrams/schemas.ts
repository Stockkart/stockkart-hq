import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

import { DIAGRAM_KINDS, DIAGRAM_TITLE_MAX, THUMBNAIL_MAX_BYTES } from "./constants";

/**
 * Zod input schemas for the diagram server actions (DGM-*). Isomorphic; the server always
 * re-validates. The scene itself is validated per kind by the service (`parseScene`), since
 * the kind is the stored diagram's, not something the client chooses on save.
 */

const id = z.uuid();
const projectKey = z.string().regex(PROJECT_KEY_PATTERN);
export const diagramTitle = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Title is required").max(DIAGRAM_TITLE_MAX, "Title is too long"));
/** Diagrams per project are few; this only bounds the index a client may send. */
const MAX_INDEX = 10_000;

export const createDiagramInput = z.object({
  projectKey,
  title: diagramTitle,
  /** Ignored when a template is given: the template decides the kind (DGM-3). */
  kind: z.enum(DIAGRAM_KINDS).default("whiteboard"),
  templateId: id.nullish(),
});
export type CreateDiagramInput = z.input<typeof createDiagramInput>;

/**
 * §7.4 autosave with optimistic locking: succeeds only while the diagram is still at
 * `baseVersion`. `title` is sent only when it changed; `scene` is checked per kind (and
 * against the 1.5 MB limit) by the service.
 */
export const saveDiagramInput = z.object({
  diagramId: id,
  baseVersion: z.number().int().positive(),
  title: diagramTitle.optional(),
  scene: z.unknown(),
  /** "Save version": always keep a snapshot of this save. */
  snapshot: z.boolean().default(false),
});

export const renameDiagramInput = z.object({ diagramId: id, title: diagramTitle });
export const diagramIdInput = z.object({ diagramId: id });

/** Fractional ordering of the list: the diagram's new index among the others. */
export const moveDiagramInput = z.object({
  diagramId: id,
  index: z.number().int().min(0).max(MAX_INDEX),
});

/** DGM-4 restore = a new version holding the old scene (history is never rewritten). */
export const restoreDiagramVersionInput = z.object({
  diagramId: id,
  version: z.number().int().positive(),
  /** The version the editor is at, so a restore over someone else's newer save conflicts. */
  baseVersion: z.number().int().positive(),
});

export const diagramVersionInput = z.object({
  diagramId: id,
  version: z.number().int().positive(),
});

/** "Linked" panel: a manual link from the diagram to an issue (by key) or a doc (by id). */
export const linkDiagramInput = z.discriminatedUnion("target", [
  z.object({
    diagramId: id,
    target: z.literal("issue"),
    issueKey: z.string().trim().min(1, "Issue key is required").max(20),
  }),
  z.object({ diagramId: id, target: z.literal("doc"), docId: id }),
]);

export const unlinkDiagramInput = z.object({ diagramId: id, linkId: id });

/** DGM-5: ask for a presigned PUT of the PNG thumbnail (size checked before signing). */
export const thumbnailUploadInput = z.object({
  diagramId: id,
  sizeBytes: z
    .number()
    .int()
    .min(1, "Thumbnail is empty")
    .max(THUMBNAIL_MAX_BYTES, "Thumbnail is too large"),
});

/** Picker queries (doc embed "Insert diagram", Linked → doc). */
export const pickerQueryInput = z.object({
  projectKey,
  q: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(200)),
});
