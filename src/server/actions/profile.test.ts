import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const profileService = vi.hoisted(() => ({ get: vi.fn(), setGithubLogin: vi.fn() }));
vi.mock("@/server/services", () => ({ profileService }));

const { setGithubLoginAction } = await import("./profile");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};

describe("setGithubLoginAction", () => {
  beforeEach(() => {
    authMock.mockReset();
    profileService.setGithubLogin.mockReset().mockResolvedValue({ githubLogin: "imf-ali" });
    revalidatePath.mockReset();
  });

  it("refuses without a session and touches nothing", async () => {
    authMock.mockResolvedValue(null);
    await expect(setGithubLoginAction({ githubLogin: "imf-ali" })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(profileService.setGithubLogin).not.toHaveBeenCalled();
  });

  it("sets the SESSION user's username (no user id is accepted)", async () => {
    authMock.mockResolvedValue(session);
    const result = await setGithubLoginAction({ githubLogin: "@imf-ali", userId: "someone-else" });
    expect(result).toEqual({ ok: true, data: { githubLogin: "imf-ali" } });
    expect(profileService.setGithubLogin).toHaveBeenCalledWith(ID, { githubLogin: "imf-ali" });
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/settings/profile",
      "/[projectKey]/issues/[key]",
    ]);
  });

  it.each(["-bad", "bad-", "a--b", "x".repeat(40), "has space", 42])(
    "rejects %j before the service",
    async (githubLogin) => {
      authMock.mockResolvedValue(session);
      await expect(setGithubLoginAction({ githubLogin })).resolves.toMatchObject({ ok: false });
      expect(profileService.setGithubLogin).not.toHaveBeenCalled();
    },
  );

  it("reports a username taken by another user", async () => {
    authMock.mockResolvedValue(session);
    profileService.setGithubLogin.mockRejectedValue(
      new ServiceError("conflict", "Another HQ user already has that GitHub username"),
    );
    await expect(setGithubLoginAction({ githubLogin: "octocat" })).resolves.toEqual({
      ok: false,
      error: "Another HQ user already has that GitHub username",
    });
  });
});
