import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "@/features/shell/sidebar";
import { TopBar } from "@/features/shell/top-bar";
import { requirePageSession } from "@/server/auth/require-session";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Second gate after the proxy (S-2): the app shell never renders without a session.
  const session = await requirePageSession();

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar userName={session.user.name || session.user.email} />
        <main id="main" className="flex-1 p-6">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
