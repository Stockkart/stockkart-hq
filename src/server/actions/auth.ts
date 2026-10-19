"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { safeCallbackPath } from "@/server/auth/access-policy";
import { signIn, signOut } from "@/server/auth/auth";
import { isSignInErrorCode, SIGN_IN_MESSAGES, SignInFailed } from "@/server/auth/errors";
import { requireSession, UnauthorizedError } from "@/server/auth/require-session";

export interface SignInState {
  error: string | null;
  /** Echoed back so the form can keep the email after React resets it. Never the password. */
  email: string;
}

/**
 * Login form action. Server actions get Next.js's Origin check, which is the CSRF protection
 * for this form (S-3b); Auth.js skips its own CSRF token for server-side signIn().
 */
export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const rawEmail = formData.get("email");
  const password = formData.get("password");
  const email = typeof rawEmail === "string" ? rawEmail.trim().slice(0, 254) : "";
  if (!email || typeof password !== "string" || !password) {
    return { error: SIGN_IN_MESSAGES.invalid_credentials, email };
  }

  try {
    // On success this throws Next.js's redirect signal, which must propagate (see below).
    await signIn("credentials", {
      email,
      password,
      redirectTo: safeCallbackPath(formData.get("callbackUrl")),
    });
    return { error: null, email };
  } catch (error) {
    if (error instanceof SignInFailed && isSignInErrorCode(error.code)) {
      return { error: SIGN_IN_MESSAGES[error.code], email };
    }
    if (error instanceof AuthError) {
      return { error: SIGN_IN_MESSAGES.unavailable, email };
    }
    // Includes the NEXT_REDIRECT signal on success.
    throw error;
  }
}

export async function signOutAction(): Promise<void> {
  // S-2: server action IDs can be POSTed from any page (including the public /login), so
  // re-check the session here too. Without one there is nothing to end: go to /login.
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }
  await signOut({ redirectTo: "/login" });
}
