import type { ReactNode } from "react";

import { requirePageSession } from "@/server/auth/require-session";

interface Props {
  children: ReactNode;
}

/**
 * The docs pages' frame. The page tree is no longer beside every page (docs UX): the docs
 * index shows it in full (that page is about navigation), and a doc page opens it in its
 * "Pages" drawer or a pinned column, so the content gets the room.
 */
export default async function DocsLayout({ children }: Props) {
  // Layouts and pages render in parallel, so the layout checks the session itself too.
  await requirePageSession();
  return <div className="mx-auto max-w-7xl">{children}</div>;
}
