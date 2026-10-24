import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GithubLoginForm } from "@/features/settings/github-login-form";
import { NotificationSettings } from "@/features/settings/notification-settings";
import { ThemeSwitcher } from "@/features/theme/theme-switcher";
import { requirePageSession } from "@/server/auth/require-session";
import { EMAIL_NOT_CONFIGURED_MESSAGE, emailConfigured } from "@/server/email";
import { notificationQueries, profileService } from "@/server/services";
import { getThemePreference } from "@/server/theme/preference";

export const metadata: Metadata = { title: "Profile" };

/** Settings → Profile: the signed-in user's own details and GitHub username (GH-4). */
export default async function ProfilePage() {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  // Scoped to the session user; batched with the layout's reads (one round trip).
  // The theme comes from the cookie (no DB round trip).
  const [profile, digest, themePreference] = await Promise.all([
    profileService.get(session.user.id),
    notificationQueries.digestSettings(session.user.id),
    getThemePreference(),
  ]);
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
      <section aria-labelledby="appearance-heading" className="flex flex-col gap-2">
        <h2 id="appearance-heading" className="text-lg font-medium">
          Appearance
        </h2>
        <p className="text-sm text-muted-foreground">
          Theme for this browser. System follows your device setting.
        </p>
        <div>
          <ThemeSwitcher initialPreference={themePreference} variant="labelled" />
        </div>
      </section>
      <GithubLoginForm initialLogin={profile.githubLogin} />
      <NotificationSettings
        initialNotifyEmail={digest.notifyEmail}
        initialFrequency={digest.digestFrequency}
        // NTF-2 fails closed without Resend: the choice is saved, nothing is sent.
        emailReady={emailConfigured()}
        notConfiguredMessage={EMAIL_NOT_CONFIGURED_MESSAGE}
      />
    </div>
  );
}
