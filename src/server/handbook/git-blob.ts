import { createHash } from "node:crypto";

/**
 * The git blob id of a file's content: `sha1("blob <byte length>\0" + bytes)`, exactly what
 * `git hash-object` and the GitHub API report for that file. Publish records it before the
 * PR is merged, so the merge (and later pushes) can be matched without asking GitHub.
 */
export function gitBlobSha(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
