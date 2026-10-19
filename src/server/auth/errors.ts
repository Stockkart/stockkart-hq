import { CredentialsSignin } from "next-auth";

/**
 * Sign-in failure codes. Auth.js puts `code` into a URL query parameter, so codes must
 * never hint at whether an email exists. Wrong password, unknown email and rate limiting
 * all share `invalid_credentials`.
 */
export const SIGN_IN_ERROR_CODES = ["invalid_credentials", "access_denied", "unavailable"] as const;
export type SignInErrorCode = (typeof SIGN_IN_ERROR_CODES)[number];

export const SIGN_IN_MESSAGES: Record<SignInErrorCode, string> = {
  invalid_credentials: "Invalid email or password",
  access_denied: "Access denied",
  unavailable: "Sign-in is temporarily unavailable. Please try again in a few minutes.",
};

export class SignInFailed extends CredentialsSignin {
  constructor(code: SignInErrorCode) {
    super();
    this.code = code;
  }
}

export function isSignInErrorCode(value: unknown): value is SignInErrorCode {
  return typeof value === "string" && (SIGN_IN_ERROR_CODES as readonly string[]).includes(value);
}
