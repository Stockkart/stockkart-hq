import { Boxes } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasValidSession, safeCallbackPath } from "@/server/auth/access-policy";
import { auth } from "@/server/auth/auth";
import { isSignInErrorCode, SIGN_IN_MESSAGES } from "@/server/auth/errors";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Maps Auth.js redirect errors (`?error=…&code=…`) to the same fixed, non-revealing texts. */
function messageFromQuery(params: Record<string, string | string[] | undefined>): string | null {
  const error = params.error;
  if (!error) return null;
  const code = params.code;
  if (isSignInErrorCode(code)) return SIGN_IN_MESSAGES[code];
  if (error === "AccessDenied") return SIGN_IN_MESSAGES.access_denied;
  if (error === "CredentialsSignin") return SIGN_IN_MESSAGES.invalid_credentials;
  return SIGN_IN_MESSAGES.unavailable;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(params.callbackUrl);

  const session = await auth();
  if (hasValidSession(session)) redirect(callbackPath);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Boxes aria-hidden="true" className="size-8" />
          <h1 className="text-xl font-semibold">Sign in to Stockkart HQ</h1>
          <p className="text-sm text-muted-foreground">Use your Stockkart staff account.</p>
        </div>
        <LoginForm callbackPath={callbackPath} initialError={messageFromQuery(params)} />
      </div>
    </main>
  );
}
