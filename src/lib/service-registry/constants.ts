/**
 * Service registry vocabulary (SPEC §4.14 SVC-1) shared by the schema, server code and UI.
 * Isomorphic. Named `service-registry` so it is not confused with `server/services/`.
 *
 * NEVER store credentials here: no passwords, tokens, keys or connection strings, in any
 * column (notes and descriptions included) or in a URL. The registry says where things are,
 * not how to get in. URLs are checked with `parseSafeUrl` (`lib/links/safe-url.ts`), which
 * refuses `user:password@` URLs.
 */

/** `services.links[].kind`. */
export const SERVICE_LINK_KINDS = [
  "app",
  "logs",
  "dashboard",
  "db_console",
  "docs",
  "other",
] as const;
export type ServiceLinkKind = (typeof SERVICE_LINK_KINDS)[number];

export const SERVICE_LINK_KIND_LABELS: Record<ServiceLinkKind, string> = {
  app: "App",
  logs: "Logs",
  dashboard: "Dashboard",
  db_console: "DB console",
  docs: "Docs",
  other: "Other",
};

/** One element of `services.links` (a JSON array). */
export interface ServiceLink {
  kind: ServiceLinkKind;
  label: string;
  url: string;
}

/** One element of `services.environments` (a JSON array), e.g. `{ name: "production" }`. */
export interface ServiceEnvironment {
  name: string;
  url?: string;
  notes?: string;
}

/** Most entries per array; also a CHECK on `services.links` / `services.environments`. */
export const SERVICE_MAX_LINKS = 50;
export const SERVICE_MAX_ENVIRONMENTS = 50;

/** `services.slug`: lowercase words joined by single hyphens, ≤ 64 characters (CHECK). */
export const SERVICE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SERVICE_SLUG_MAX = 64;

/** `services.repo`: `Owner/repo`, e.g. `Stockkart/inventory-api` (CHECK). */
export const SERVICE_REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Form limits (SVC-1). The DB checks the slug, repo and array sizes; these keep rows small. */
export const SERVICE_NAME_MAX = 100;
export const SERVICE_DESCRIPTION_MAX = 2_000;
export const SERVICE_RUNTIME_MAX = 100;
export const SERVICE_NOTES_MAX = 5_000;
export const SERVICE_REPO_MAX = 140;
export const SERVICE_ENV_NAME_MAX = 50;
export const SERVICE_ENV_NOTES_MAX = 500;
export const SERVICE_LINK_LABEL_MAX = 80;

/** Shown on the form and the list (SVC-1 "No secrets"). */
export const NO_SECRETS_NOTICE = "Don't store passwords, tokens or connection strings here.";

/** "Recent incidents" on a service card: incidents that started within this many days. */
export const RECENT_INCIDENT_DAYS = 90;
