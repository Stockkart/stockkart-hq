import {
  AppWindow,
  BookOpen,
  Database,
  ExternalLink,
  Gauge,
  Link2,
  type LucideIcon,
  ScrollText,
} from "lucide-react";

import { parseSafeUrl } from "@/lib/links/safe-url";
import {
  SERVICE_LINK_KIND_LABELS,
  SERVICE_REPO_PATTERN,
  type ServiceEnvironment,
  type ServiceLink,
  type ServiceLinkKind,
} from "@/lib/service-registry/constants";
import { cn } from "@/lib/utils";

/**
 * Small pieces of the service cards and the service page (SVC-1). No "use client": they
 * render on the server too. Every href passes `parseSafeUrl` again here, so even a bad row
 * can never become a `javascript:` link (S-8). Links open in a new tab with `noreferrer`
 * (these URLs may be internal consoles) and are never fetched by the server (SSRF).
 */

export const LINK_KIND_ICONS: Record<ServiceLinkKind, LucideIcon> = {
  app: AppWindow,
  logs: ScrollText,
  dashboard: Gauge,
  db_console: Database,
  docs: BookOpen,
  other: Link2,
};

/** `https://github.com/Owner/repo` for a stored `Owner/repo`, else null. */
export function repoUrl(repo: string | null): string | null {
  return repo && SERVICE_REPO_PATTERN.test(repo) ? `https://github.com/${repo}` : null;
}

export function QuickLinks({ links, className }: { links: ServiceLink[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label="Quick links">
      {links.map((link, index) => {
        const href = parseSafeUrl(link.url);
        if (!href) return null;
        const Icon = LINK_KIND_ICONS[link.kind];
        return (
          <li key={`${link.kind}-${index}`}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              title={`${SERVICE_LINK_KIND_LABELS[link.kind]}: ${href}`}
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Icon aria-hidden="true" className="size-3.5" />
              <span>{link.label}</span>
              <span className="sr-only">
                {" "}
                ({SERVICE_LINK_KIND_LABELS[link.kind]}, opens in a new tab)
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function EnvironmentChips({ environments }: { environments: ServiceEnvironment[] }) {
  if (environments.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Environments">
      {environments.map((env, index) => {
        const href = env.url ? parseSafeUrl(env.url) : null;
        const chip =
          "inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground";
        return (
          <li key={`${env.name}-${index}`}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                title={env.notes ? `${href} — ${env.notes}` : href}
                className={cn(
                  chip,
                  "outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
                )}
              >
                {env.name}
                <ExternalLink aria-hidden="true" className="size-3" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className={chip} title={env.notes}>
                {env.name}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
