"use client";

import { Boxes } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { SidebarViews } from "@/features/views/sidebar-views";
import { cn } from "@/lib/utils";
import { type SavedViewItem } from "@/lib/views/saved-views";

import { DEFAULT_PROJECT_KEY, NAV_SECTIONS } from "./nav-items";

/** VW-3: the signed-in user's saved views (and shared ones) of the default project. */
export function Sidebar({ savedViews = [] }: { savedViews?: SavedViewItem[] }) {
  // Sticky at full viewport height: the page scrolls, the sidebar stays put (its nav scrolls).
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col self-start border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <Boxes aria-hidden="true" className="size-5" />
        <span>Stockkart HQ</span>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_SECTIONS.map((section, index) => {
          const headingId = section.heading ? `nav-heading-${section.heading}` : undefined;
          return (
            <div
              key={section.heading ?? `section-${index}`}
              className={cn(index > 0 && "mt-3 border-t pt-3")}
            >
              {section.heading ? (
                <h2
                  id={headingId}
                  className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground"
                >
                  {section.heading}
                </h2>
              ) : null}
              <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const itemClass =
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
                  if (!item.href) {
                    return (
                      <li key={item.label}>
                        <span
                          aria-disabled="true"
                          className={cn(itemClass, "cursor-not-allowed text-muted-foreground")}
                        >
                          <Icon aria-hidden="true" className="size-4" />
                          <span className="flex-1">{item.label}</span>
                          <span className="text-[10px] uppercase">Soon</span>
                        </span>
                      </li>
                    );
                  }
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          itemClass,
                          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {section.heading === DEFAULT_PROJECT_KEY ? (
                <Suspense fallback={null}>
                  <SidebarViews projectKey={DEFAULT_PROJECT_KEY} views={savedViews} />
                </Suspense>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
