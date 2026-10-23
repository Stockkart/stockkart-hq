import { env } from "@/env";

import { createHandbookGithub, handbookAppConfigFrom } from "./github-app";

/**
 * The handbook GitHub App client, wired from env once (server-only: imports `@/env`). See
 * `github-app.ts` for the security model and README "Engineering handbook sync" for setup.
 * The installation token is cached per server instance, in memory only.
 */
export const handbookGithub = createHandbookGithub({ config: handbookAppConfigFrom(env) });

/** Whether the App is fully configured; no request is made. */
export const handbookConfigured = () => handbookGithub.configured();

/** What the UI may show about the setup: never the key or the installation. */
export function handbookConfigView() {
  return {
    configured: handbookConfigured(),
    repo: env.HANDBOOK_REPO,
    repoUrl: `https://github.com/${env.HANDBOOK_REPO}`,
  };
}
