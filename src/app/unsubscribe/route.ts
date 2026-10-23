import { clientIpFrom } from "@/server/auth/rate-limit";
import { unsubscribeService } from "@/server/email";
import { createUnsubscribeHandlers } from "@/server/email/routes";

/**
 * NTF-2 one-click unsubscribe (RFC 8058), linked from every digest. Public in the proxy
 * (exact path) because the recipient may not be signed in; the random token in the link is
 * the credential (only its sha-256 is stored), POSTs are rate limited per IP, and GET only
 * shows a confirmation button. See `server/email/routes.ts`.
 */
const handlers = createUnsubscribeHandlers({
  service: () => unsubscribeService,
  clientIp: clientIpFrom,
});

export function GET(request: Request): Response {
  return handlers.GET(request);
}

export function POST(request: Request): Promise<Response> {
  return handlers.POST(request);
}

export const dynamic = "force-dynamic";
