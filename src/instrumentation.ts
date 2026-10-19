/**
 * Runs once when a Next.js server instance starts. Importing the env module validates every
 * required variable, so a misconfigured deployment fails at startup rather than on the first
 * sign-in attempt.
 */
export async function register(): Promise<void> {
  await import("./env");
}
