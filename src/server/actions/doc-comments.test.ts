import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rt } from "@/lib/rich-text";
import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const commentService = vi.hoisted(() => ({
  createDocComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  setThreadResolved: vi.fn(),
}));
vi.mock("@/server/services", () => ({ commentService }));

const {
  createDocCommentAction,
  deleteDocCommentAction,
  editDocCommentAction,
  resolveDocThreadAction,
} = await import("./doc-comments");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ME = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const DOC = "11111111-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const COMMENT = "22222222-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const body = rt.doc(rt.paragraph("Hi"));
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ME, name: "Test Staff", email: "staff@example.test" },
};

const actions = [
  ["createDocCommentAction", () => createDocCommentAction({ docId: DOC, body })],
  ["editDocCommentAction", () => editDocCommentAction({ commentId: COMMENT, body })],
  ["deleteDocCommentAction", () => deleteDocCommentAction({ commentId: COMMENT })],
  ["resolveDocThreadAction", () => resolveDocThreadAction({ commentId: COMMENT, resolved: true })],
] as const;

describe("doc comment actions (DOC-11, DOC-13)", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePath.mockReset();
    for (const fn of Object.values(commentService)) fn.mockReset();
    commentService.createDocComment.mockResolvedValue({ id: COMMENT, threadId: COMMENT });
    commentService.setThreadResolved.mockResolvedValue({ resolvedAt: new Date(0) });
  });

  it.each(actions)("%s requires a session", async (_name, run) => {
    authMock.mockResolvedValue(null);
    await expect(run()).rejects.toBeInstanceOf(UnauthorizedError);
    for (const fn of Object.values(commentService)) expect(fn).not.toHaveBeenCalled();
  });

  it("rejects bad input before the service runs", async () => {
    authMock.mockResolvedValue(session);
    const bad = await createDocCommentAction({
      docId: DOC,
      body,
      parentId: COMMENT,
      anchor: { id: "abc", text: "x" },
    });
    expect(bad.ok).toBe(false);
    expect(
      (await createDocCommentAction({ docId: DOC, body, anchor: { id: "no!", text: "" } })).ok,
    ).toBe(false);
    expect((await resolveDocThreadAction({ commentId: "x", resolved: true })).ok).toBe(false);
    expect(commentService.createDocComment).not.toHaveBeenCalled();
    expect(commentService.setThreadResolved).not.toHaveBeenCalled();
  });

  it("acts as the session user and refreshes only the doc page", async () => {
    authMock.mockResolvedValue(session);
    for (const [, run] of actions) expect((await run()).ok).toBe(true);
    expect(commentService.createDocComment).toHaveBeenCalledWith(ME, { docId: DOC, body });
    expect(commentService.setThreadResolved).toHaveBeenCalledWith(ME, {
      commentId: COMMENT,
      resolved: true,
    });
    expect(commentService.deleteComment).toHaveBeenCalledWith(ME, COMMENT);
    expect(new Set(revalidatePath.mock.calls.map(([path]) => path))).toEqual(
      new Set(["/[projectKey]/docs/[id]"]),
    );
  });

  it("maps service errors to a message", async () => {
    authMock.mockResolvedValue(session);
    commentService.editComment.mockRejectedValue(
      new ServiceError("forbidden", "You can only change your own comments"),
    );
    expect(await editDocCommentAction({ commentId: COMMENT, body })).toEqual({
      ok: false,
      error: "You can only change your own comments",
    });
  });
});
