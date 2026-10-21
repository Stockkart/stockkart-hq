import { type AnyExtension } from "@tiptap/core";

import { mergeRegistries } from "@/lib/registry";

import { diagramEmbedFeature } from "./diagram-embed";
import { calloutFeature, mermaidFeature, tableFeature } from "./doc-blocks";
import {
  type EditorExtensionContext,
  type EditorFeature,
  type EditorVariant,
  type ToolbarButton,
} from "./types";

/**
 * Editor feature registry (client-only, like the editor). Each feature lives in its own file
 * in this folder; adding one is ONE line here, so parallel slices never edit the editor
 * itself (see AGENTS.md "Adding an editor node"). Order matters: it is the order of the
 * extensions and of the insert buttons.
 */
const FEATURES: readonly EditorFeature[] = [
  calloutFeature,
  tableFeature,
  mermaidFeature,
  diagramEmbedFeature,
  // P1 slices add one line each, e.g. mentionFeature, imageFeature, diagramEmbedFeature.
];

/** In registry order; throws at load if two features share a name (see `mergeRegistries`). */
export const EDITOR_FEATURES: readonly EditorFeature[] = [
  ...mergeRegistries(
    "Editor features",
    FEATURES.map((feature) => ({ [feature.name]: feature })),
  ).values(),
];

export function featuresFor(
  variant: EditorVariant,
  features: readonly EditorFeature[] = EDITOR_FEATURES,
): EditorFeature[] {
  return features.filter((feature) => feature.variants.includes(variant));
}

/** The registered features' Tiptap extensions for one editor. */
export function featureExtensions(
  context: EditorExtensionContext,
  features: readonly EditorFeature[] = EDITOR_FEATURES,
): AnyExtension[] {
  return featuresFor(context.variant, features).flatMap((feature) => feature.extensions(context));
}

/** The registered features' toolbar groups: one "insert" group, then their own groups. */
export function featureToolbarGroups(
  variant: EditorVariant,
  features: readonly EditorFeature[] = EDITOR_FEATURES,
): ToolbarButton[][] {
  const active = featuresFor(variant, features);
  const insert = active.flatMap((feature) => feature.insertButtons ?? []);
  const own = active.flatMap((feature) => feature.toolbarGroups ?? []);
  return [...(insert.length > 0 ? [insert] : []), ...own.filter((group) => group.length > 0)];
}

export {
  EDITOR_VARIANTS,
  type EditorExtensionContext,
  type EditorFeature,
  type EditorVariant,
  type ToolbarButton,
  type ToolbarContext,
} from "./types";
