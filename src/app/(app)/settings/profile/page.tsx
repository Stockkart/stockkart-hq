import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GithubLoginForm } from "@/features/settings/github-login-form";
import { requirePageSession } from "@/server/auth/require-session";
import { profileService } from "@/server/services";

export const metadata: Metadata = { title: "Profile" };

/** Settings → Profile: the signed-in user's own details and GitHub username (GH-4). */
export default async function ProfilePage() {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  // Scoped to the session user; one read, batched with the layout's.
  const profile = await profileService.get(session.user.id);
  if (!profile) redirect("/login");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your name and email come from your Stockkart account.
        </p>
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{profile.name}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd>{profile.email}</dd>
      </dl>
      <GithubLoginForm initialLogin={profile.githubLogin} />
    </div>
  );
}
