import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const attachmentService = vi.hoisted(() => ({
  startUpload: vi.fn(),
  confirmUpload: vi.fn(),
  cancelUpload: vi.fn(),
  deleteAttachment: vi.fn(),
  adoptForComment: vi.fn(),
}));
vi.mock("@/server/services", () => ({ attachmentService }));

const {
  adoptCommentAttachmentsAction,
  confirmUploadAction,
  deleteAttachmentAction,
  startUploadAction,
} = await import("./attachments");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const USER = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const ISSUE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ID = "11111111-2222-4333-8444-555555555555";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: USER, name: "Test Staff", email: "staff@example.test" },
};
const valid = {
  entityType: "issue",
  entityId: ISSUE,
  filename: "shot.png",
  mime: "image/png",
  size: 1024,
  width: 800,
  height: 600,
};

describe("attachment actions (ISS-9, S-2)", () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(session);
    Object.values(attachmentService).forEach((fn) => fn.mockReset());
    revalidatePath.mockReset();
  });

  it("refuses without a session and touches nothing", async () => {
    authMock.mockResolvedValue(null);
    await expect(startUploadAction(valid)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(confirmUploadAction({ attachmentId: ID })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(deleteAttachmentAction({ attachmentId: ID })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(attachmentService.startUpload).not.toHaveBeenCalled();
    expect(attachmentService.confirmUpload).not.toHaveBeenCalled();
    expect(attachmentService.deleteAttachment).not.toHaveBeenCalled();
  });

  it("starts an upload for the session user", async () => {
    attachmentService.startUpload.mockResolvedValue({ attachmentId: ID });
    await expect(startUploadAction(valid)).resolves.toEqual({
      ok: true,
      data: { attachmentId: ID },
    });
    expect(attachmentService.startUpload).toHaveBeenCalledWith(USER, valid);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown entity type", { entityType: "sprint" }],
    ["a bad entity id", { entityId: "STK-1" }],
    ["an empty file", { size: 0 }],
    ["a file over 10 MB", { size: 10 * 1024 * 1024 + 1 }],
    ["a fractional size", { size: 1.5 }],
    ["no file name", { filename: "  " }],
    ["a control character in the name", { filename: "a\r\nb.png" }],
    ["a zero width", { width: 0 }],
  ])("rejects %s before the service", async (_label, change) => {
    await expect(startUploadAction({ ...valid, ...change })).resolves.toMatchObject({ ok: false });
    expect(attachmentService.startUpload).not.toHaveBeenCalled();
  });

  it("returns the service's graceful errors (e.g. storage not configured)", async () => {
    attachmentService.startUpload.mockRejectedValue(
      new ServiceError("invalid", "File storage isn't set up yet"),
    );
    await expect(startUploadAction(valid)).resolves.toEqual({
      ok: false,
      error: "File storage isn't set up yet",
    });
  });

  it("refreshes the page that lists the confirmed or deleted file", async () => {
    attachmentService.confirmUpload.mockResolvedValue({ id: ID, entityType: "doc" });
    await confirmUploadAction({ attachmentId: ID });
    expect(attachmentService.confirmUpload).toHaveBeenCalledWith(USER, ID);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/[projectKey]/docs/[id]"]);

    revalidatePath.mockReset();
    attachmentService.deleteAttachment.mockResolvedValue({ entityType: "issue" });
    await expect(deleteAttachmentAction({ attachmentId: ID })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(attachmentService.deleteAttachment).toHaveBeenCalledWith(USER, ID);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/[projectKey]/issues/[key]"]);

    revalidatePath.mockReset();
    attachmentService.confirmUpload.mockResolvedValue({ id: ID, entityType: "comment" });
    await confirmUploadAction({ attachmentId: ID });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("validates the adoption input", async () => {
    await expect(
      adoptCommentAttachmentsAction({ commentId: ID, attachmentIds: [] }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      adoptCommentAttachmentsAction({ commentId: ID, attachmentIds: ["nope"] }),
    ).resolves.toMatchObject({ ok: false });
    expect(attachmentService.adoptForComment).not.toHaveBeenCalled();
    attachmentService.adoptForComment.mockResolvedValue({ moved: 1 });
    await expect(
      adoptCommentAttachmentsAction({ commentId: ID, attachmentIds: [ISSUE] }),
    ).resolves.toEqual({ ok: true, data: { moved: 1 } });
    expect(attachmentService.adoptForComment).toHaveBeenCalledWith(USER, {
      commentId: ID,
      attachmentIds: [ISSUE],
    });
  });
});
