"use client";

import { useEffect } from "react";

import { recordIssueViewAction } from "@/server/actions/planning";

/**
 * MY-1 "recently viewed": records the visit once the issue page is actually shown in the
 * browser (so link prefetches never count as views). Failures are ignored: it is a
 * convenience list, not an audit log.
 */
export function RecordIssueView({ issueId }: { issueId: string }) {
  useEffect(() => {
    recordIssueViewAction({ issueId }).catch(() => {});
  }, [issueId]);
  return null;
}
