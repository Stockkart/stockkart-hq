import { redirect } from "next/navigation";

import { requirePageSession } from "@/server/auth/require-session";

export default async function HomePage() {
  await requirePageSession();
  redirect("/my-work");
}
