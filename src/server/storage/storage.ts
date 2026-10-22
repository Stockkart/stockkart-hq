import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import {
  classifyUpload,
  type Disposition,
  effectiveDisposition,
  isAllowedUploadSize,
} from "@/lib/attachments/policy";

import { contentDisposition } from "./disposition";
import { StorageInputError, StorageNotConfigured } from "./errors";
import { isAppKey } from "./keys";

/**
 * Cloudflare R2 through its S3-compatible API (SPEC §7.3, S-5). The bucket is private and
 * stays private: objects are reached only through presigned URLs that live at most
 * `PRESIGN_TTL_SECONDS`, handed out by authenticated server code (`/api/files/[id]`).
 * Nothing here builds a public URL.
 *
 * Fail closed: while the R2 env vars are incomplete, every function except
 * `storageConfigured()` throws `StorageNotConfigured`.
 */

export interface StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** ≤ 5 minutes (S-5) for every presigned URL, upload and download alike. */
export const PRESIGN_TTL_SECONDS = 300;

/**
 * Lets the browser keep a downloaded object for the URL's own lifetime only, and never in a
 * shared cache.
 */
const DOWNLOAD_CACHE_CONTROL = `private, max-age=${PRESIGN_TTL_SECONDS}`;

/** The full config, or null when any R2 variable is missing (storage then fails closed). */
export function storageConfigFrom(source: {
  R2_ACCOUNT_ID?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  R2_BUCKET?: string | undefined;
}): StorageConfig | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = source;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  };
}

export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

type ObjectCommand = PutObjectCommand | HeadObjectCommand | DeleteObjectCommand;
type PresignCommand = PutObjectCommand | GetObjectCommand;

/** The S3 calls the module makes; injected so tests never touch the network. */
export interface StorageTransport {
  send(command: ObjectCommand): Promise<unknown>;
  presign(
    command: PresignCommand,
    options: { expiresIn: number; signableHeaders?: Set<string> },
  ): Promise<string>;
}

export function createR2Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: r2Endpoint(config.accountId),
    // Path-style (`<endpoint>/<bucket>/<key>`): one host for every bucket name, so TLS and
    // the bucket's CORS rule always match.
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 does not support the SDK's default CRC32 request checksums on presigned PUTs (the
    // checksum of an empty body would be signed into the URL); only send them when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function createR2Transport(config: StorageConfig): StorageTransport {
  const client = createR2Client(config);
  return {
    send: (command) => client.send(command),
    presign: (command, options) => getSignedUrl(client, command, options),
  };
}

export interface PresignedUpload {
  url: string;
  method: "PUT";
  /** Send exactly these; Content-Length is signed too and set by the browser from the body. */
  headers: { "Content-Type": string };
  expiresAt: Date;
}

export interface ObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

const headOutput = z.object({
  ContentLength: z.number().int().nonnegative().optional(),
  ContentType: z.string().optional(),
});

/** No CR/LF or other control characters may reach a signed header. */
function isHeaderSafe(value: string): boolean {
  return value.length > 0 && value.length <= 255 && !/[\x00-\x1f\x7f]/.test(value);
}

/**
 * The stored Content-Type must be what the policy would choose for this key's file name, so
 * an SVG can never be stored as `image/svg+xml` and an image never as `text/html`.
 */
function assertPolicyContentType(key: string, contentType: string): void {
  if (!isHeaderSafe(contentType) || classifyUpload(contentType, key).contentType !== contentType) {
    throw new StorageInputError("Content type is not allowed for this file");
  }
}

function assertUploadable(key: string, sizeBytes: number, contentType: string): void {
  if (!isAppKey(key)) throw new StorageInputError("Invalid storage key");
  if (!isAllowedUploadSize(sizeBytes)) throw new StorageInputError("File is empty or too large");
  assertPolicyContentType(key, contentType);
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? error.name : undefined;
  const metadata = "$metadata" in error ? error.$metadata : undefined;
  const status =
    typeof metadata === "object" && metadata !== null && "httpStatusCode" in metadata
      ? metadata.httpStatusCode
      : undefined;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}

/**
 * The storage API. `transport` is created lazily on first use (no client, and no
 * credentials touched, until something is actually stored or signed).
 */
export function createStorage(
  config: StorageConfig | null,
  makeTransport: (config: StorageConfig) => StorageTransport = createR2Transport,
  now: () => Date = () => new Date(),
) {
  let transport: StorageTransport | null = null;
  const ready = (): { config: StorageConfig; transport: StorageTransport } => {
    if (!config) throw new StorageNotConfigured();
    transport ??= makeTransport(config);
    return { config, transport };
  };

  return {
    /** True when all four R2 variables are set. Everything else throws when this is false. */
    storageConfigured(): boolean {
      return config !== null;
    },

    /**
     * A presigned PUT for a direct browser → R2 upload (Vercel function bodies cap at
     * ~4.5 MB). Content-Type and Content-Length are part of the signature, so the client
     * cannot upload a different type or size; the URL expires after 5 minutes. Only
     * attachment and thumbnail keys (`isAppKey`) can be signed.
     *
     * The URL stays usable until it expires, also after the server confirmed the object, so
     * the uploader could replace it with another file of the same type and size within those
     * 5 minutes. That is no more than the same signed-in user uploading a second file;
     * confirm (`headObject`) after use rather than relying on the object being immutable.
     */
    async presignUpload(input: {
      key: string;
      contentType: string;
      contentLength: number;
    }): Promise<PresignedUpload> {
      const { config: cfg, transport: t } = ready();
      assertUploadable(input.key, input.contentLength, input.contentType);
      const url = await t.presign(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
        }),
        {
          expiresIn: PRESIGN_TTL_SECONDS,
          // The presigner leaves content-type unsigned by default; sign both explicitly.
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      );
      return {
        url,
        method: "PUT",
        headers: { "Content-Type": input.contentType },
        expiresAt: new Date(now().getTime() + PRESIGN_TTL_SECONDS * 1000),
      };
    },

    /**
     * A presigned GET (≤ 5 minutes) that makes R2 answer with our Content-Type and
     * Content-Disposition, whatever was stored. The upload policy is applied again here:
     * `inline` is downgraded to `attachment` for types that may not be shown inline, and
     * active types (SVG, HTML, …) are always served as `application/octet-stream`.
     */
    async presignDownload(input: {
      key: string;
      filename: string;
      disposition: Disposition;
      contentType: string;
    }): Promise<string> {
      const { config: cfg, transport: t } = ready();
      // Only attachment and thumbnail keys: never a backup, whatever the DB row says.
      if (!isAppKey(input.key)) throw new StorageInputError("Invalid storage key");
      const policy = classifyUpload(input.contentType, input.filename);
      return t.presign(
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: input.key,
          ResponseContentType: policy.contentType,
          ResponseContentDisposition: contentDisposition(
            effectiveDisposition(policy, input.disposition),
            input.filename,
          ),
          ResponseCacheControl: DOWNLOAD_CACHE_CONTROL,
        }),
        { expiresIn: PRESIGN_TTL_SECONDS },
      );
    },

    /** Size and type of a stored object, or null when it does not exist. */
    async headObject(key: string): Promise<ObjectInfo | null> {
      const { config: cfg, transport: t } = ready();
      if (!isAppKey(key)) throw new StorageInputError("Invalid storage key");
      try {
        const output = headOutput.parse(
          await t.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })),
        );
        return { sizeBytes: output.ContentLength ?? 0, contentType: output.ContentType ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /**
     * Deletes an attachment or thumbnail object (backups are managed by their lifecycle
     * rule, never by the app). Soft deletes do NOT call this (§9.3).
     */
    async deleteObject(key: string): Promise<void> {
      const { config: cfg, transport: t } = ready();
      if (!isAppKey(key)) throw new StorageInputError("Invalid storage key");
      await t.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },

    /** Server-side write, e.g. a thumbnail rendered on the server. Same policy as uploads. */
    async putObject(input: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
      const { config: cfg, transport: t } = ready();
      assertUploadable(input.key, input.body.byteLength, input.contentType);
      await t.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.body.byteLength,
        }),
      );
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;
