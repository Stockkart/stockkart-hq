import { z } from "zod";

import { GITHUB_LOGIN_PATTERN } from "./refs";

/**
 * Profile: the signed-in user's GitHub username (GH-4 maps PR and commit authors to HQ
 * users with it). Empty clears it; a leading "@" is dropped. Isomorphic (used by the form).
 */
export const githubLoginInput = z.object({
  githubLogin: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, ""))
    .refine((value) => value === "" || GITHUB_LOGIN_PATTERN.test(value), {
      message:
        "A GitHub username has up to 39 letters, digits or single hyphens, and cannot start or end with a hyphen",
    })
    .transform((value) => (value === "" ? null : value)),
});

export type GithubLoginInput = z.output<typeof githubLoginInput>;
