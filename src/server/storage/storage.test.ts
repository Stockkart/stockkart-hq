import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorageInputError, StorageNotConfigured } from "./errors";
import { attachmentKey, diagramThumbnailKey } from "./keys";
import {
  createR2Client,
  createR2Transport,
  createStorage,
  PRESIGN_TTL_SECONDS,
  type StorageConfig,
  storageConfigFrom,
  type StorageTransport,
} from "./storage";

/** Fake, non-secret values. Signing is local; no test here opens a connection. */
const config: StorageConfig = {
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key-not-real",
  bucket: "hq-test-bucket",
};
const KEY = attachmentKey("Screenshot 1.png", "11111111-2222-4333-8444-555555555555");

function fakeTransport(send: StorageTransport["send"] = vi.fn()): StorageTransport {
  return { send, presign: vi.fn(async () => "https://signed.invalid/") };
}

/** Real S3 client and presigner (offline), so the signed URL itself is checked. */
const realStorage = () =>
  createStorage(config, createR2Transport, () => new Date("2026-03-01T10:00:00Z"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage configuration (fail closed)", () => {
  it("is configured only with all four R2 variables", () => {
    expect(storageConfigFrom({})).toBeNull();
    expect(
      storageConfigFrom({ R2_ACCOUNT_ID: config.accountId, R2_BUCKET: config.bucket }),
    ).toBeNull();
    expect(
      storageConfigFrom({
        R2_ACCOUNT_ID: config.accountId,
        R2_ACCESS_KEY_ID: config.accessKeyId,
        R2_SECRET_ACCESS_KEY: config.secretAccessKey,
        R2_BUCKET: config.bucket,
      }),
    ).toEqual(config);
  });

  it("throws StorageNotConfigured from every call and never creates a client", async () => {
    const makeTransport = vi.fn(() => fakeTransport());
    const storage = createStorage(null, makeTransport);
    expect(storage.storageConfigured()).toBe(false);
    const calls = [
      storage.presignUpload({ key: KEY, contentType: "image/png", contentLength: 10 }),
      storage.presignDownload({
        key: KEY,
        filename: "a.png",
        disposition: "inline",
        contentType: "image/png",
      }),
      storage.headObject(KEY),
      storage.deleteObject(KEY),
      storage.putObject({ key: KEY, body: new Uint8Array([1]), contentType: "image/png" }),
    ];
    for (const call of calls) await expect(call).rejects.toBeInstanceOf(StorageNotConfigured);
    expect(makeTransport).not.toHaveBeenCalled();
  });

  it("points the client at the account's R2 endpoint with region auto", async () => {
    const client: S3Client = createR2Client(config);
    expect(await client.config.region()).toBe("auto");
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe(`${config.accountId}.r2.cloudflarestorage.com`);
    expect(endpoint?.protocol).toBe("https:");
  });
});

describe("presignUpload (S-5)", () => {
  it("signs Content-Type and Content-Length into a PUT URL valid for 5 minutes", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const upload = await realStorage().presignUpload({
      key: KEY,
      contentType: "image/png",
      contentLength: 1234,
    });
    const url = new URL(upload.url);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(`${config.accountId}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${config.bucket}/${KEY}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_TTL_SECONDS));
    expect(PRESIGN_TTL_SECONDS).toBeLessThanOrEqual(300);
    const signed = url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    // No default checksum (R2 would reject the empty-body CRC) and no credentials in clear.
    expect(url.search).not.toMatch(/checksum/i);
    expect(upload.url).not.toContain(config.secretAccessKey);
    expect(upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/png" } });
    expect(upload.expiresAt.toISOString()).toBe("2026-03-01T10:05:00.000Z");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("signs a different URL for a different size, so the client cannot change it", async () => {
    const storage = realStorage();
    const a = await storage.presignUpload({ key: KEY, contentType: "image/png", contentLength: 1 });
    const b = await storage.presignUpload({ key: KEY, contentType: "image/png", contentLength: 2 });
    expect(new URL(a.url).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(b.url).searchParams.get("X-Amz-Signature"),
    );
  });

  it.each([
    ["an empty file", KEY, "image/png", 0],
    ["a file over 10 MB", KEY, "image/png", 10 * 1024 * 1024 + 1],
    ["a fractional size", KEY, "image/png", 1.5],
    ["a backups/ key", "backups/x.sql.gz", "application/octet-stream", 10],
    ["a tmp/ key", "tmp/x", "application/octet-stream", 10],
    ["a key outside our prefixes", "other/x.png", "image/png", 10],
    ["a traversal key", "attachments/../backups/x.png", "image/png", 10],
    ["an SVG stored as image/svg+xml", "attachments/a/x.svg", "image/svg+xml", 10],
    ["an HTML file stored as text/html", "attachments/a/x.html", "text/html", 10],
    ["a header-injecting type", KEY, "image/png\r\nx-evil: 1", 10],
  ])("refuses %s", async (_name, key, contentType, contentLength) => {
    const transport = fakeTransport();
    const storage = createStorage(config, () => transport);
    await expect(storage.presignUpload({ key, contentType, contentLength })).rejects.toBeInstanceOf(
      StorageInputError,
    );
    expect(transport.presign).not.toHaveBeenCalled();
  });

  it("accepts an SVG only as application/octet-stream", async () => {
    const transport = fakeTransport();
    const storage = createStorage(config, () => transport);
    await storage.presignUpload({
      key: attachmentKey("logo.svg"),
      contentType: "application/octet-stream",
      contentLength: 10,
    });
    expect(transport.presign).toHaveBeenCalledTimes(1);
  });
});

describe("presignDownload (S-5, S-8)", () => {
  const download = async (input: {
    filename: string;
    contentType: string;
    disposition: "inline" | "attachment";
  }) => new URL(await realStorage().presignDownload({ key: KEY, ...input }));

  it("serves an image inline with its type, for at most 5 minutes", async () => {
    const url = await download({
      filename: "Screenshot 1.png",
      contentType: "image/png",
      disposition: "inline",
    });
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_TTL_SECONDS));
    expect(url.searchParams.get("response-content-type")).toBe("image/png");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      `inline; filename="Screenshot 1.png"; filename*=UTF-8''Screenshot%201.png`,
    );
    expect(url.searchParams.get("response-cache-control")).toBe("private, max-age=300");
  });

  it.each([
    ["image/svg+xml", "logo.svg"],
    ["text/html", "page.html"],
    ["image/png", "trick.svg"],
    ["application/xhtml+xml", "x.xhtml"],
  ])("always downloads %s (%s) as application/octet-stream", async (contentType, filename) => {
    const url = await download({ filename, contentType, disposition: "inline" });
    expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^attachment;/);
  });

  it("serves text attachments as attachment even when inline is asked for", async () => {
    const url = await download({
      filename: "server.log",
      contentType: "text/plain",
      disposition: "inline",
    });
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^attachment;/);
    expect(url.searchParams.get("response-content-type")).toBe("text/plain; charset=utf-8");
  });

  it("lets a PDF be inline when asked, and keeps the exact name in filename*", async () => {
    const inline = await download({
      filename: 'Résumé "final".pdf',
      contentType: "application/pdf",
      disposition: "inline",
    });
    expect(inline.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(inline.searchParams.get("response-content-disposition")).toBe(
      `inline; filename="Resume _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`,
    );
  });

  it.each(["../secret", "backups/stockkart-hq-2026.sql.gz", "tmp/stockkart-hq-2026.sql.gz"])(
    "refuses to sign a download for %s",
    async (key) => {
      const transport = fakeTransport();
      const storage = createStorage(config, () => transport);
      await expect(
        storage.presignDownload({
          key,
          filename: "a.png",
          contentType: "image/png",
          disposition: "inline",
        }),
      ).rejects.toBeInstanceOf(StorageInputError);
      await expect(storage.headObject(key)).rejects.toBeInstanceOf(StorageInputError);
      expect(transport.presign).not.toHaveBeenCalled();
      expect(transport.send).not.toHaveBeenCalled();
    },
  );
});

describe("server-side object calls (mocked S3 client)", () => {
  it("headObject returns size and type, and null for a missing object", async () => {
    const send = vi
      .fn<StorageTransport["send"]>()
      .mockResolvedValueOnce({ ContentLength: 42, ContentType: "image/png", $metadata: {} })
      .mockRejectedValueOnce(
        Object.assign(new Error("not found"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        }),
      )
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    const storage = createStorage(config, () => fakeTransport(send));
    expect(await storage.headObject(KEY)).toEqual({ sizeBytes: 42, contentType: "image/png" });
    expect(await storage.headObject(KEY)).toBeNull();
    await expect(storage.headObject(KEY)).rejects.toThrow("denied");
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command?.input).toEqual({ Bucket: config.bucket, Key: KEY });
  });

  it("deleteObject deletes attachments and thumbnails, never backups", async () => {
    const send = vi.fn<StorageTransport["send"]>().mockResolvedValue({});
    const storage = createStorage(config, () => fakeTransport(send));
    await storage.deleteObject(KEY);
    const thumbnail = diagramThumbnailKey("11111111-2222-4333-8444-555555555555");
    await storage.deleteObject(thumbnail);
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      expect.any(DeleteObjectCommand),
      expect.any(DeleteObjectCommand),
    ]);
    expect(send.mock.calls[1]?.[0].input).toEqual({ Bucket: config.bucket, Key: thumbnail });
    await expect(storage.deleteObject("backups/2026.sql.gz")).rejects.toBeInstanceOf(
      StorageInputError,
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("putObject writes with the policy's type and exact length", async () => {
    const send = vi.fn<StorageTransport["send"]>().mockResolvedValue({});
    const storage = createStorage(config, () => fakeTransport(send));
    const key = diagramThumbnailKey("11111111-2222-4333-8444-555555555555");
    const body = new Uint8Array([137, 80, 78, 71]);
    await storage.putObject({ key, body, contentType: "image/png" });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command?.input).toMatchObject({
      Bucket: config.bucket,
      Key: key,
      ContentType: "image/png",
      ContentLength: 4,
    });
    await expect(storage.putObject({ key, body, contentType: "text/html" })).rejects.toBeInstanceOf(
      StorageInputError,
    );
  });
});
