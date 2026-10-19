import { describe, expect, it } from "vitest";

import {
  API_BASE,
  apiError,
  callsTo,
  loginOk,
  memoryAttemptStore,
  memoryUserRepository,
  mockFetch,
  requestFromIp,
  timeoutError,
} from "@/test/stockkart-fakes";

import { createAuthorize } from "./authorize";
import { SIGN_IN_MESSAGES, SignInFailed } from "./errors";
import { createRateLimiter, MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP } from "./rate-limit";
import { createStockkartClient } from "./stockkart-client";

function setup(handler: Parameters<typeof mockFetch>[0]) {
  const fetchMock = mockFetch(handler);
  const store = memoryAttemptStore();
  const users = memoryUserRepository();
  const authorize = createAuthorize({
    client: createStockkartClient({ baseUrl: API_BASE, fetch: fetchMock }),
    limiter: createRateLimiter(store),
    users,
  });
  return { authorize, fetchMock, store, users };
}

const credentials = { email: "staff@example.test", password: "correct horse" };

async function expectSignInError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SignInFailed);
  expect(error).toMatchObject({ code });
}

describe("authorize()", () => {
  it("accepts a SUPER_USER, upserts the HQ user and keeps the Stockkart token", async () => {
    const { authorize, fetchMock, users } = setup((url) =>
      url.endsWith("/auth/login") ? loginOk("SUPER_USER", "tok-super") : apiError(404),
    );

    const user = await authorize(credentials, requestFromIp("203.0.113.5"));

    expect(user).toMatchObject({
      id: "hq-1",
      name: "Test Staff",
      email: "staff@example.test",
      stockkartUserId: "sk-user-1",
      stockkartAccessToken: "tok-super",
    });
    expect(users.upserts).toEqual([
      { stockkartUserId: "sk-user-1", name: "Test Staff", email: "staff@example.test" },
    ]);

    const [loginCall] = callsTo(fetchMock, "/api/v1/auth/login");
    expect(loginCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual(credentials);
    expect(callsTo(fetchMock, "/api/v1/auth/logout")).toHaveLength(0);
  });

  it.each(["OWNER", "CASHIER", "ADMIN", "MANAGER"])(
    "rejects role %s with 'Access denied' and drops its token via logout",
    async (role) => {
      const { authorize, fetchMock, users } = setup((url) =>
        url.endsWith("/auth/login")
          ? loginOk(role, `tok-${role}`)
          : new Response(null, { status: 200 }),
      );

      await expectSignInError(
        authorize(credentials, requestFromIp("203.0.113.5")),
        "access_denied",
      );

      const logoutCalls = callsTo(fetchMock, "/api/v1/auth/logout");
      expect(logoutCalls).toHaveLength(1);
      expect(logoutCalls[0]?.[1]).toMatchObject({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer tok-${role}` }),
      });
      expect(users.upserts).toHaveLength(0);
      expect(SIGN_IN_MESSAGES.access_denied).toBe("Access denied");
    },
  );

  it("rejects bad credentials with the generic message", async () => {
    const { authorize, store } = setup(() => apiError(401, "Invalid email or password"));

    await expectSignInError(
      authorize({ ...credentials, password: "wrong" }, requestFromIp("203.0.113.5")),
      "invalid_credentials",
    );
    expect(SIGN_IN_MESSAGES.invalid_credentials).toBe("Invalid email or password");
    expect(store.rows.filter((row) => !row.success)).toHaveLength(2); // email + ip keys
  });

  it("gives an unknown email exactly the same answer as a wrong password", async () => {
    const { authorize } = setup(() => apiError(401));
    await expectSignInError(
      authorize({ email: "nobody@example.test", password: "x" }, requestFromIp("203.0.113.5")),
      "invalid_credentials",
    );
  });

  it("rejects malformed input without calling inventory-api", async () => {
    const { authorize, fetchMock } = setup(() => loginOk("SUPER_USER"));
    await expectSignInError(
      authorize({ email: "not-an-email", password: "" }, requestFromIp("203.0.113.5")),
      "invalid_credentials",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it(`blocks an email after ${MAX_FAILURES_PER_EMAIL} failures, even with the right password`, async () => {
    let passwordIsRight = false;
    const { authorize, fetchMock } = setup(() =>
      passwordIsRight ? loginOk("SUPER_USER") : apiError(401),
    );

    for (let attempt = 0; attempt < MAX_FAILURES_PER_EMAIL; attempt += 1) {
      await expectSignInError(
        authorize({ ...credentials, password: "wrong" }, requestFromIp(`198.51.100.${attempt}`)),
        "invalid_credentials",
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(MAX_FAILURES_PER_EMAIL);

    passwordIsRight = true;
    // Same generic error as a wrong password; inventory-api is not even asked.
    await expectSignInError(
      authorize(credentials, requestFromIp("198.51.100.99")),
      "invalid_credentials",
    );
    expect(fetchMock).toHaveBeenCalledTimes(MAX_FAILURES_PER_EMAIL);

    // Case and whitespace do not give a fresh budget.
    await expectSignInError(
      authorize({ ...credentials, email: " STAFF@example.test " }, requestFromIp("198.51.100.98")),
      "invalid_credentials",
    );
    expect(fetchMock).toHaveBeenCalledTimes(MAX_FAILURES_PER_EMAIL);
  });

  it(`blocks an IP after ${MAX_FAILURES_PER_IP} failures across different emails`, async () => {
    const { authorize, fetchMock } = setup(() => apiError(401));
    const ip = requestFromIp("192.0.2.10");

    for (let attempt = 0; attempt < MAX_FAILURES_PER_IP; attempt += 1) {
      await expectSignInError(
        authorize({ email: `user${attempt}@example.test`, password: "x" }, ip),
        "invalid_credentials",
      );
    }
    await expectSignInError(
      authorize({ email: "fresh@example.test", password: "x" }, ip),
      "invalid_credentials",
    );
    expect(fetchMock).toHaveBeenCalledTimes(MAX_FAILURES_PER_IP);
  });

  it("counts a non-SUPER_USER sign-in as a failed attempt", async () => {
    const { authorize, store } = setup((url) =>
      url.endsWith("/auth/login") ? loginOk("OWNER") : new Response(null, { status: 200 }),
    );
    await expectSignInError(authorize(credentials, requestFromIp("203.0.113.5")), "access_denied");
    expect(store.rows.filter((row) => !row.success).map((row) => row.key)).toEqual([
      "email:staff@example.test",
      "ip:203.0.113.5",
    ]);
  });

  it.each([
    ["a 5xx", () => apiError(503)],
    ["a timeout", () => Promise.reject(timeoutError())],
    ["an unexpected body", () => new Response("<html>", { status: 200 })],
  ])("reports 'unavailable' on %s and does not count it as a failure", async (_label, respond) => {
    const { authorize, store } = setup(respond);
    await expectSignInError(authorize(credentials, requestFromIp("203.0.113.5")), "unavailable");
    expect(store.rows).toHaveLength(0);
  });

  it("fails closed when the rate-limit store is unreachable", async () => {
    const fetchMock = mockFetch(() => loginOk("SUPER_USER"));
    const authorize = createAuthorize({
      client: createStockkartClient({ baseUrl: API_BASE, fetch: fetchMock }),
      limiter: { reserve: () => Promise.reject(new Error("db down")) },
      users: memoryUserRepository(),
    });
    await expectSignInError(authorize(credentials, requestFromIp("203.0.113.5")), "unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks the reserved attempt as a success after a good sign-in", async () => {
    const { authorize, store } = setup((url) =>
      url.endsWith("/auth/login") ? loginOk("SUPER_USER") : apiError(404),
    );
    await authorize(credentials, requestFromIp("203.0.113.5"));
    expect(store.rows.map(({ key, success }) => ({ key, success }))).toEqual([
      { key: "email:staff@example.test", success: true },
      { key: "ip:203.0.113.5", success: true },
    ]);
  });

  it("releases the reservation when the user upsert fails after a good login", async () => {
    const fetchMock = mockFetch((url) =>
      url.endsWith("/auth/login") ? loginOk("SUPER_USER") : new Response(null, { status: 200 }),
    );
    const store = memoryAttemptStore();
    const authorize = createAuthorize({
      client: createStockkartClient({ baseUrl: API_BASE, fetch: fetchMock }),
      limiter: createRateLimiter(store),
      users: {
        ...memoryUserRepository(),
        upsertOnSignIn: () => Promise.reject(new Error("db down")),
      },
    });
    await expectSignInError(authorize(credentials, requestFromIp("203.0.113.5")), "unavailable");
    expect(store.rows).toHaveLength(0);
    expect(callsTo(fetchMock, "/api/v1/auth/logout")).toHaveLength(1);
  });

  describe("concurrent attempts (atomic reservation)", () => {
    it(`lets at most ${MAX_FAILURES_PER_EMAIL} of 10 parallel attempts for one email reach inventory-api`, async () => {
      // Resolve logins only after every attempt has started, so a check-then-record limiter
      // would let all 10 through before the first failure is written.
      let releaseLogins: () => void = () => {};
      const loginsHeld = new Promise<void>((resolve) => {
        releaseLogins = resolve;
      });
      const { authorize, fetchMock } = setup(async () => {
        await loginsHeld;
        return apiError(401);
      });

      const attempts = Array.from({ length: 10 }, (_, i) =>
        expectSignInError(
          authorize({ ...credentials, password: `guess-${i}` }, requestFromIp(`198.51.100.${i}`)),
          "invalid_credentials",
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseLogins();
      await Promise.all(attempts);

      expect(callsTo(fetchMock, "/api/v1/auth/login")).toHaveLength(MAX_FAILURES_PER_EMAIL);
    });

    it(`lets at most ${MAX_FAILURES_PER_IP} of 30 parallel attempts from one IP through`, async () => {
      const { authorize, fetchMock } = setup(() => apiError(401));
      const ip = requestFromIp("192.0.2.77");
      await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          expectSignInError(
            authorize({ email: `user${i}@example.test`, password: "x" }, ip),
            "invalid_credentials",
          ),
        ),
      );
      expect(callsTo(fetchMock, "/api/v1/auth/login")).toHaveLength(MAX_FAILURES_PER_IP);
    });
  });
});
