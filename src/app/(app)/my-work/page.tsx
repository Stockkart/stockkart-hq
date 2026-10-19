import type { Metadata } from "next";

import { requirePageSession } from "@/server/auth/require-session";

export const metadata: Metadata = { title: "My Work" };

export default async function MyWorkPage() {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const name = session.user.name || session.user.email;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">My Work</h1>
      <p className="text-muted-foreground">
        Welcome, <span className="font-medium text-foreground">{name}</span>.
      </p>
      <section
        aria-labelledby="assigned-heading"
        className="mt-6 rounded-lg border border-dashed p-8 text-center"
      >
        <h2 id="assigned-heading" className="font-medium">
          Nothing here yet
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Issues assigned to you, mentions and recently viewed items will show up here.
        </p>
      </section>
    </div>
  );
}
