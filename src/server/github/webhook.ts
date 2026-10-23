import { type z } from "zod";

import { type DeliveryResult } from "@/server/services/github";
import { pgErrorInfo } from "@/server/services/errors";
import { isHandbookRepository, planHandbookDelivery } from "@/server/handbook/webhook-plan";

import { createPayload, type GithubRepository, pullRequestPayload, pushPayload } from "./payloads";
import { type DeliveryPlan, isOrgRepository, planCreate, planPullRequest, planPush } from "./plan";
import { verifyGithubSignature } from "./signature";

/**
 * POST /api/webhooks/github (GH-1, S-4). Public in the proxy because GitHub holds no
 * session; the HMAC signature is the authentication. Order matters:
 *
 *   1. no secret configured      → 503, nothing read (fail closed)
 *   2. no signature header       → 401, body not read
 *   3. body over 1 MB            → 413 (read in chunks, never buffered past the limit)
 *   4. signature mismatch        → 401, before any JSON parsing or database work
 *   5. ping → 200; unhandled events → 202; malformed JSON or payload shape → 400
 *   6. repository outside the Stockkart org → 200, no effect
 *   7. apply in one statement, deduped by X-GitHub-Delivery → 200 (a database error → 500,
 *      nothing written, so "Redeliver" in GitHub retries it). For the handbook repo
 *      (DOC-14) the same statement also updates publications and docs' sync state
 *      (`server/handbook/webhook-plan.ts`); still no GitHub API call.
 *
 * Logs carry the event, delivery id, repository and counts only: never the secret, the
 * signature or the payload.
 */

export const MAX_BODY_BYTES = 1024 * 1024;

const HANDLED_EVENTS = new Set(["pull_request", "push", "create"]);
const DELIVERY_ID = /^[A-Za-z0-9-]{1,100}$/;
const EVENT_NAME = /^[a-z_]{1,50}$/;

export interface WebhookDeps {
  /** Read per request, so a secret set later takes effect without a code change. */
  secret: () => string | undefined;
  apply: (plan: DeliveryPlan) => Promise<DeliveryResult>;
  /** Re-renders the pages that show what changed. */
  refresh: (result: DeliveryResult) => void;
  /**
   * DOC-14: `Owner/repo` of the handbook (HANDBOOK_REPO). Its pull requests and pushes also
   * update the docs' sync state, inside the same deduped statement. No GitHub API call is
   * ever made from here.
   */
  handbookRepo?: () => string;
  log?: (line: Record<string, unknown>) => void;
}

// One JSON line on stdout (console.info is not allowed by lint; see query-log.ts).
const defaultLog = (line: Record<string, unknown>) =>
  process.stdout.write(`[github-webhook] ${JSON.stringify(line)}\n`);

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The body as bytes, or null once it exceeds `limit` (stops reading at that point). */
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return undefined;
  }
}

type Parsed =
  | { ok: true; repository: GithubRepository; plan: (base: Base) => DeliveryPlan }
  | { ok: false; ignored?: string };

interface Base {
  deliveryId: string;
  event: string;
}

function parseEvent(event: string, payload: unknown): Parsed {
  const parse = <S extends z.ZodType>(schema: S) => schema.safeParse(payload);
  switch (event) {
    case "pull_request": {
      const result = parse(pullRequestPayload);
      if (!result.success) return { ok: false };
      const data = result.data;
      return { ok: true, repository: data.repository, plan: (base) => planPullRequest(base, data) };
    }
    case "push": {
      const result = parse(pushPayload);
      if (!result.success) return { ok: false };
      const data = result.data;
      return { ok: true, repository: data.repository, plan: (base) => planPush(base, data) };
    }
    case "create": {
      const result = parse(createPayload);
      if (!result.success) return { ok: false };
      const data = result.data;
      if (data.ref_type !== "branch") return { ok: false, ignored: "tag" };
      return { ok: true, repository: data.repository, plan: (base) => planCreate(base, data) };
    }
    default:
      return { ok: false };
  }
}

export function createGithubWebhookHandler(deps: WebhookDeps) {
  const log = deps.log ?? defaultLog;

  return async function POST(request: Request): Promise<Response> {
    const secret = deps.secret();
    if (!secret) {
      // Fail closed: without a secret no delivery can be verified, so none is accepted.
      log({ outcome: "not_configured" });
      return json(503, { error: "not_configured" });
    }
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) return json(401, { error: "invalid_signature" });

    const body = await readBody(request, MAX_BODY_BYTES);
    if (!body) return json(413, { error: "payload_too_large" });
    if (!verifyGithubSignature(secret, body, signature)) {
      log({ outcome: "invalid_signature" });
      return json(401, { error: "invalid_signature" });
    }

    // Authenticated from here on.
    const event = request.headers.get("x-github-event") ?? "";
    const deliveryId = request.headers.get("x-github-delivery") ?? "";
    if (!DELIVERY_ID.test(deliveryId) || !EVENT_NAME.test(event)) {
      return json(400, { error: "bad_headers" });
    }
    if (event === "ping") return json(200, { ok: true, event });
    if (!HANDLED_EVENTS.has(event)) {
      log({ event, deliveryId, outcome: "ignored_event" });
      return json(202, { ok: true, ignored: "event" });
    }

    const payload = parseJson(body);
    if (payload === undefined) return json(400, { error: "invalid_json" });
    const parsed = parseEvent(event, payload);
    if (!parsed.ok) {
      if (parsed.ignored) return json(202, { ok: true, ignored: parsed.ignored });
      log({ event, deliveryId, outcome: "invalid_payload" });
      return json(400, { error: "invalid_payload" });
    }
    const repo = parsed.repository.full_name;
    if (!isOrgRepository(parsed.repository)) {
      // S-4: deliveries about repositories outside the org change nothing.
      log({ event, deliveryId, repo, outcome: "ignored_repo" });
      return json(200, { ok: true, ignored: "repository" });
    }

    const plan: DeliveryPlan = {
      ...parsed.plan({ deliveryId, event }),
      // DOC-14, after the signature, the payload and the org checks above.
      handbook:
        deps.handbookRepo && isHandbookRepository(parsed.repository, deps.handbookRepo())
          ? planHandbookDelivery(event, payload, parsed.repository)
          : null,
    };
    const counts = {
      refs: plan.refs.length,
      closes: plan.closes?.issues.length ?? 0,
      ...(plan.handbook
        ? {
            handbookPaths: plan.handbook.paths.length,
            handbookPr: plan.handbook.pullRequest?.outcome ?? null,
            ...(plan.handbook.truncated ? { handbookTruncated: true } : {}),
          }
        : {}),
    };
    if (plan.refs.length === 0 && !plan.pullRequest && !plan.closes && !plan.handbook) {
      // Nothing mentions an issue (most pushes): no database work at all.
      log({ event, deliveryId, repo, ...counts, outcome: "nothing_to_link" });
      return json(200, { ok: true, linked: 0, updated: 0, moved: 0 });
    }

    let result: DeliveryResult;
    try {
      result = await deps.apply(plan);
    } catch (error) {
      // Driver errors can carry the statement's parameters (titles, commit messages), so
      // only the Postgres error code is logged. Nothing was written (one statement), so
      // GitHub's "Redeliver" retries it cleanly.
      log({ event, deliveryId, repo, ...counts, outcome: "error", code: pgErrorInfo(error)?.code });
      return json(500, { error: "internal" });
    }
    log({ event, deliveryId, repo, ...counts, ...result, outcome: "applied" });
    if (result.duplicate) return json(200, { ok: true, duplicate: true });
    const handbook = result.handbook ?? 0;
    if (result.linked > 0 || result.updated > 0 || result.moved > 0 || handbook > 0) {
      deps.refresh(result);
    }
    return json(200, {
      ok: true,
      linked: result.linked,
      updated: result.updated,
      moved: result.moved,
      ...(plan.handbook ? { handbook } : {}),
    });
  };
}
