import { LogOut } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { QuickCreate } from "@/features/issue/quick-create";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { CommandPalette } from "@/features/search/command-palette";
import { type IssueType } from "@/lib/issues/constants";
import { type RichTextDoc } from "@/lib/rich-text";
import { type SprintOption } from "@/lib/sprints/views";
import { signOutAction } from "@/server/actions/auth";

import { DEFAULT_PROJECT_KEY } from "./nav-items";
import { ShortcutHelp } from "./shortcut-help";

interface TopBarProps {
  userName: string;
  /** Quick-create templates, loaded with the page. */
  issueTemplates?: Partial<Record<IssueType, RichTextDoc>>;
  /** Quick-create sprint options per project key, loaded with the page. */
  sprintOptions?: Record<string, SprintOption[]>;
  /** NTF-1 bell badge, loaded with the page (the layout's batched read). */
  unreadNotifications?: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function TopBar({
  userName,
  issueTemplates,
  sprintOptions,
  unreadNotifications = 0,
}: TopBarProps) {
  return (
    <header className="flex h-14 items-center gap-3 border-b px-4">
      {/* ⌘K search (SRCH-1). */}
      <div className="flex flex-1 items-center">
        <CommandPalette defaultProjectKey={DEFAULT_PROJECT_KEY} />
      </div>
      <QuickCreate
        defaultProjectKey={DEFAULT_PROJECT_KEY}
        initialTemplates={issueTemplates}
        sprintOptionsByProject={sprintOptions}
      />
      <ShortcutHelp />
      <NotificationBell initialUnread={unreadNotifications} />
      <Link
        href="/settings/profile"
        title={`${userName}: profile`}
        className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span aria-hidden="true">{initials(userName)}</span>
        <span className="sr-only">Signed in as {userName}. Profile settings</span>
      </Link>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </header>
  );
}
