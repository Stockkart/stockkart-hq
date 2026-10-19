"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type SignInState } from "@/server/actions/auth";

interface LoginFormProps {
  callbackPath: string;
  initialError: string | null;
}

export function LoginForm({ callbackPath, initialError }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signInAction, {
    error: initialError,
    email: "",
  });
  const passwordRef = useRef<HTMLInputElement>(null);
  const error = state.error;

  // React resets the form after each action; the email comes back via defaultValue and
  // focus moves to the (now empty) password field for a quick retry.
  useEffect(() => {
    if (state.error && state.email) passwordRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackPath} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          defaultValue={state.email}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>

      {/* Always rendered so assistive tech announces changes to its content. */}
      <p
        id="login-error"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="min-h-5 text-sm font-medium text-destructive"
      >
        {error ?? ""}
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
