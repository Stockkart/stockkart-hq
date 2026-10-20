import { Bell, LogOut, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QuickCreate } from "@/features/issue/quick-create";
import { signOutAction } from "@/server/actions/auth";

import { DEFAULT_PROJECT_KEY } from "./nav-items";

interface TopBarProps {
  userName: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function TopBar({ userName }: TopBarProps) {
  return (
    <header className="flex h-14 items-center gap-3 border-b px-4">
      {/* Placeholders for ⌘K search (SRCH-1) and notifications (NTF-1). */}
      <div className="flex flex-1 items-center">
        <div
          aria-disabled="true"
          className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground"
        >
          <Search aria-hidden="true" className="size-4" />
          <span>Search or jump to… (coming soon)</span>
        </div>
      </div>
      <QuickCreate defaultProjectKey={DEFAULT_PROJECT_KEY} />
      <Button variant="ghost" size="icon" disabled aria-label="Notifications (coming soon)">
        <Bell aria-hidden="true" />
      </Button>
      <span
        title={userName}
        className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
      >
        <span aria-hidden="true">{initials(userName)}</span>
        <span className="sr-only">Signed in as {userName}</span>
      </span>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </header>
  );
}
