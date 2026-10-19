import { CredentialsSignin } from "next-auth";

import { type SignInErrorCode } from "@/lib/sign-in-messages";

// Codes and messages live in a client-safe module; re-exported for server code.
export {
  isSignInErrorCode,
  SIGN_IN_ERROR_CODES,
  SIGN_IN_MESSAGES,
  type SignInErrorCode,
} from "@/lib/sign-in-messages";

export class SignInFailed extends CredentialsSignin {
  constructor(code: SignInErrorCode) {
    super();
    this.code = code;
  }
}
