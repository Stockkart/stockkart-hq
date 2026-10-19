import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  /** Returned by `authorize()`; only seen by the `jwt` callback at sign-in. */
  interface User {
    stockkartUserId?: string;
    stockkartAccessToken?: string;
    sessionVersion?: number;
  }

  /** What server code gets from `auth()` / `requireSession()`. Never holds the Stockkart token. */
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
    };
  }
}

declare module "next-auth/jwt" {
  /** Contents of the encrypted session cookie. */
  interface JWT {
    stockkartUserId?: string;
    stockkartAccessToken?: string;
    /** Epoch ms after which the session ends regardless of activity. */
    stockkartTokenExpiresAt?: number;
    /** Epoch ms of the last successful `/auth/me` check. */
    lastVerifiedAt?: number;
    /** Epoch ms when the next `/auth/me` check is due. */
    recheckAt?: number;
    sessionVersion?: number;
  }
}
