import Link from "next/link";

import { type BoardScope } from "@/lib/sprints/constants";
import { boardHref } from "@/lib/sprints/schemas";
import { cn } from "@/lib/utils";

/**
 * BRD-3 scope switch: "Sprint 7" / "All open". Plain links, so the scope lives in the URL
 * (`?scope=all`), survives reloads and can be shared; the current one is `aria-current`.
 */
export function BoardScopeSwitch({
  projectKey,
  scope,
  sprintName,
  viewQuery,
}: {
  projectKey: string;
  scope: BoardScope;
  sprintName: string;
  /** BRD-6: the type and column params, kept when the scope changes. */
  viewQuery?: URLSearchParams;
}) {
  const options: { scope: BoardScope; label: string }[] = [
    { scope: "sprint", label: sprintName },
    { scope: "all", label: "All open" },
  ];
  return (
    <nav aria-label="Board scope">
      <ul className="inline-flex rounded-md border p-0.5 text-sm">
        {options.map((option) => {
          const current = option.scope === scope;
          return (
            <li key={option.scope}>
              <Link
                href={boardHref(projectKey, option.scope, viewQuery)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block rounded-sm px-2.5 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  current ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
