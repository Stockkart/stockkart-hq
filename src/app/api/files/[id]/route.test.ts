import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StorageNotConfigured } from "@/server/storage/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const fileQueries = vi.hoisted(() => ({ readyAttachment: vi.fn(), diagramThumbnail: vi.fn() }));
vi.mock("@/server/services", () => ({ fileQueries }));
const storage = vi.hoisted(() => ({
  storageConfigured: vi.fn(() => true),
  presignDownload: vi.fn<
    (input: {
      key: string;
      filename: string;
      disposition: "inline" | "attachment";
      contentType: string;
    }) => Promise<string>
  >(async () => "https://r2.invalid/signed?X-Amz-Expires=300"),
}));
vi.mock("@/server/storage", () => ({ storage }));

const { GET } = await import("./route");
const { GET: GET_THUMBNAIL } = await import("../thumbnail/diagram/[id]/route");

const ID = "11111111-2222-4333-8444-555555555555";
const session: Session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: { id: "hq-1", name: "Test Staff", email: "staff@example.test" },
};
const image = { storageKey: `attachments/${ID}/shot.png`, filename: "shot.png", mime: "image/png" };

const get = (id: string, query = "") =>
  GET(new Request(`http://hq.test/api/files/${id}${query}`), { params: Promise.resolve({ id }) });

describe("GET /api/files/[id] (S-5)", () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(session);
    fileQueries.readyAttachment.mockReset().mockResolvedValue(image);
    fileQueries.diagramThumbnail.mockReset();
    storage.storageConfigured.mockReset().mockReturnValue(true);
    storage.presignDownload.mockClear();
  });

  it("answers 401 without a session and never looks the file up", async () => {
    authMock.mockResolvedValue(null);
    const response = await get(ID);
    expect(response.status).toBe(401);
    expect(fileQueries.readyAttachment).not.toHaveBeenCalled();
    expect(storage.presignDownload).not.toHaveBeenCalled();
  });

  it("redirects a ready attachment to a presigned URL, uncached", async () => {
    const response = await get(ID);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://r2.invalid/signed?X-Amz-Expires=300");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(fileQueries.readyAttachment).toHaveBeenCalledWith(ID);
    expect(storage.presignDownload).toHaveBeenCalledWith({
      key: image.storageKey,
      filename: "shot.png",
      disposition: "inline",
      contentType: "image/png",
    });
  });

  it("asks for attachment with ?download=1, and by default for non-images", async () => {
    await get(ID, "?download=1");
    fileQueries.readyAttachment.mockResolvedValue({
      ...image,
      filename: "a.pdf",
      mime: "application/pdf",
    });
    await get(ID);
    expect(storage.presignDownload.mock.calls.map(([input]) => input.disposition)).toEqual([
      "attachment",
      "attachment",
    ]);
  });

  it("answers 404 for an unknown, pending or deleted attachment and for a bad id", async () => {
    fileQueries.readyAttachment.mockResolvedValue(null);
    expect((await get(ID)).status).toBe(404);
    const bad = await get("not-a-uuid");
    expect(bad.status).toBe(404);
    expect(fileQueries.readyAttachment).toHaveBeenCalledTimes(1);
    expect(storage.presignDownload).not.toHaveBeenCalled();
  });

  it("answers 503 while storage is not configured", async () => {
    storage.storageConfigured.mockReturnValue(false);
    const response = await get(ID);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "not_configured",
      message: "File storage isn't set up yet",
    });
    expect(fileQueries.readyAttachment).not.toHaveBeenCalled();
  });

  it("answers 503 if the storage call itself reports it is not configured", async () => {
    storage.presignDownload.mockRejectedValueOnce(new StorageNotConfigured());
    expect((await get(ID)).status).toBe(503);
  });
});

describe("GET /api/files/thumbnail/diagram/[id] (DGM-5)", () => {
  const getThumbnail = (id: string) =>
    GET_THUMBNAIL(new Request(`http://hq.test/api/files/thumbnail/diagram/${id}`), {
      params: Promise.resolve({ id }),
    });

  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(session);
    fileQueries.diagramThumbnail.mockReset();
    storage.storageConfigured.mockReset().mockReturnValue(true);
    storage.presignDownload.mockClear();
  });

  it("answers 401 without a session", async () => {
    authMock.mockResolvedValue(null);
    expect((await getThumbnail(ID)).status).toBe(401);
    expect(fileQueries.diagramThumbnail).not.toHaveBeenCalled();
  });

  it("redirects to the thumbnail inline, or 404s without one", async () => {
    fileQueries.diagramThumbnail.mockResolvedValueOnce({
      storageKey: `thumbnails/diagrams/${ID}.png`,
      filename: `diagram-${ID}.png`,
      mime: "image/png",
    });
    const response = await getThumbnail(ID);
    expect(response.status).toBe(302);
    expect(storage.presignDownload).toHaveBeenCalledWith(
      expect.objectContaining({ key: `thumbnails/diagrams/${ID}.png`, disposition: "inline" }),
    );
    fileQueries.diagramThumbnail.mockResolvedValueOnce(null);
    expect((await getThumbnail(ID)).status).toBe(404);
  });
});
