"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { githubLoginInput } from "@/lib/github/schemas";
import { setGithubLoginAction } from "@/server/actions/profile";

/**
 * GH-4: the user's GitHub username, so their PRs and commits show with their HQ name in
 * the Development panel. Validated here for quick feedback and again on the server.
 */
export function GithubLoginForm({ initialLogin }: { initialLogin: string | null }) {
  const [value, setValue] = useState(initialLogin ?? "");
  const [saved, setSaved] = useState(initialLogin ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  function submit() {
    const parsed = githubLoginInput.safeParse({ githubLogin: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid GitHub username");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await setGithubLoginAction({ githubLogin: value });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const next = result.data.githubLogin ?? "";
        setValue(next);
        setSaved(next);
        toast.success(next ? `GitHub username set to ${next}` : "GitHub username removed");
      } catch {
        setError("Something went wrong. Reload the page and try again.");
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Label htmlFor={inputId}>GitHub username</Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          name="githubLogin"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="e.g. octocat"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${hintId} ${errorId}`}
          className="max-w-xs"
        />
        <Button type="submit" disabled={pending || value.trim() === saved}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        Links your pull requests and commits to you on issues. Leave empty to remove it.
      </p>
      <p id={errorId} aria-live="polite" className="text-sm text-destructive">
        {error}
      </p>
    </form>
  );
}
