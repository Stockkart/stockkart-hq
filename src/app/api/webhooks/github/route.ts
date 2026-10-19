import { NextResponse } from "next/server";

/**
 * GitHub webhook (GH-1, Phase 2). Public in the proxy because GitHub cannot hold a session;
 * once implemented it MUST verify the HMAC signature (constant-time compare) before reading
 * the payload (S-4). Until then it does nothing and says so.
 */
export function POST(): NextResponse {
  return NextResponse.json(
    { error: "not_implemented", message: "GitHub webhook is not implemented yet" },
    { status: 501 },
  );
}
