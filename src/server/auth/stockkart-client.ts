import { z } from "zod";

/**
 * Server-to-server client for the Stockkart backend (inventory-api) auth endpoints.
 *
 * Every response body is Zod-validated; anything unexpected is treated as "unavailable",
 * never as success. Requests time out after ~5 s so a slow backend cannot hang sign-in or
 * every page load (the session re-check runs inside the proxy).
 *
 * The Stockkart access token passed to/returned from this module must never be logged.
 */

export const STOCKKART_TIMEOUT_MS = 5_000;

export const SUPER_USER_ROLE = "SUPER_USER";

/** Fields HQ relies on from inventory-api `UserResponse` / `LoginResponse.UserSummary`. */
const stockkartUserSchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
  shopId: z.string().nullish(),
  email: z.string().nullish(),
  name: z.string().nullish(),
});

export type StockkartUser = z.infer<typeof stockkartUserSchema>;

/** inventory-api wraps every body as `ApiResponse { success, data, message, error }`. */
function apiResponse<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
  });
}

const loginResponseSchema = apiResponse(
  z.object({
    accessToken: z.string().min(1),
    user: stockkartUserSchema,
  }),
);

const meResponseSchema = apiResponse(stockkartUserSchema);

export type LoginResult =
  | { kind: "ok"; accessToken: string; user: StockkartUser }
  | { kind: "invalid_credentials" }
  | { kind: "unavailable" };

export type MeResult =
  { kind: "ok"; user: StockkartUser } | { kind: "unauthorized" } | { kind: "unavailable" };

export interface StockkartClient {
  login(email: string, password: string): Promise<LoginResult>;
  me(accessToken: string): Promise<MeResult>;
  /** Best effort: drops the token in inventory-api. Never throws. */
  logout(accessToken: string): Promise<void>;
}

export interface StockkartClientOptions {
  /** Base URL without `/api/v1`, e.g. `https://api.example.com`. */
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createStockkartClient(options: StockkartClientOptions): StockkartClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? STOCKKART_TIMEOUT_MS;
  // Resolve fetch lazily so tests can stub the global after the client is created.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);

  async function request(path: string, init: RequestInit): Promise<Response | null> {
    try {
      return await doFetch(`${baseUrl}/api/v1${path}`, {
        ...init,
        headers: { Accept: "application/json", ...init.headers },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Network error, DNS failure or timeout. Deliberately not logging the error object,
      // which can include request details.
      console.warn(`[stockkart] ${init.method ?? "GET"} ${path} failed: network error or timeout`);
      return null;
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  return {
    async login(email, password) {
      const response = await request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response) return { kind: "unavailable" };

      // 400 (validation), 401 (bad credentials / deactivated) and 403 all mean "no".
      // The caller shows one generic message for all of them.
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return { kind: "invalid_credentials" };
      }
      if (!response.ok) return { kind: "unavailable" };

      const parsed = loginResponseSchema.safeParse(await readJson(response));
      if (!parsed.success) {
        console.warn("[stockkart] login: unexpected response shape");
        return { kind: "unavailable" };
      }
      return { kind: "ok", accessToken: parsed.data.data.accessToken, user: parsed.data.data.user };
    },

    async me(accessToken) {
      const response = await request("/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response) return { kind: "unavailable" };
      if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
      if (!response.ok) return { kind: "unavailable" };

      const parsed = meResponseSchema.safeParse(await readJson(response));
      if (!parsed.success) {
        // Treated like an outage: the session is kept, but only until the 24 h
        // MAX_UNVERIFIED_MS ceiling in session-policy.ts, so a backend that keeps answering
        // with a body we cannot read cannot keep sessions alive indefinitely.
        console.warn("[stockkart] me: unexpected response shape");
        return { kind: "unavailable" };
      }
      return { kind: "ok", user: parsed.data.data };
    },

    async logout(accessToken) {
      const response = await request("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response && !response.ok && response.status !== 401) {
        console.warn(`[stockkart] logout returned ${response.status}`);
      }
    },
  };
}
