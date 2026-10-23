import { describe, expect, it } from "vitest";

import { GIT_NULL_SHA } from "./constants";
import { canPull, handbookSyncStatus, type HandbookSyncFields } from "./sync-state";

const A = "a".repeat(40);
const B = "b".repeat(40);
const seen = new Date("2026-05-01T00:00:00Z");

const synced: HandbookSyncFields = {
  version: 4,
  sourcePath: null,
  editedInHq: true,
  handbookBlobSha: A,
  handbookSyncedVersion: 4,
  handbookRemoteSha: A,
  handbookRemoteSeenAt: seen,
  openPr: null,
};

describe("handbookSyncStatus (DOC-14 state model)", () => {
  it.each<[string, Partial<HandbookSyncFields>, ReturnType<typeof handbookSyncStatus>]>([
    [
      "never synced, never seen",
      {
        handbookBlobSha: null,
        handbookSyncedVersion: null,
        handbookRemoteSha: null,
        handbookRemoteSeenAt: null,
      },
      "not_in_handbook",
    ],
    ["in sync", {}, "in_sync"],
    [
      "synced, remote not seen since",
      { handbookRemoteSha: null, handbookRemoteSeenAt: null },
      "in_sync",
    ],
    ["changed in HQ", { version: 5 }, "changed_in_hq"],
    ["changed in handbook (blob known)", { handbookRemoteSha: B }, "changed_in_handbook"],
    [
      "changed in handbook (push, blob unknown)",
      { handbookRemoteSha: null },
      "changed_in_handbook",
    ],
    ["both changed", { version: 5, handbookRemoteSha: null }, "both_changed"],
    ["removed in handbook", { handbookRemoteSha: GIT_NULL_SHA }, "removed_in_handbook"],
    [
      "PR open wins",
      { version: 5, openPr: { number: 7, url: "https://github.com/x/y/pull/7" } },
      "pr_open",
    ],
    [
      "imported, untouched in HQ, not compared yet",
      {
        handbookBlobSha: null,
        handbookSyncedVersion: null,
        handbookRemoteSha: null,
        handbookRemoteSeenAt: null,
        sourcePath: "RUNBOOK.md",
        editedInHq: false,
      },
      "changed_in_handbook",
    ],
    [
      "imported, edited in HQ, no base",
      { handbookBlobSha: null, handbookSyncedVersion: null, sourcePath: "RUNBOOK.md" },
      "both_changed",
    ],
    [
      "imported, then removed in handbook",
      {
        handbookBlobSha: null,
        handbookSyncedVersion: null,
        sourcePath: "RUNBOOK.md",
        handbookRemoteSha: GIT_NULL_SHA,
      },
      "removed_in_handbook",
    ],
    [
      "never published, absent",
      { handbookBlobSha: null, handbookSyncedVersion: null, handbookRemoteSha: GIT_NULL_SHA },
      "not_in_handbook",
    ],
  ])("%s", (_name, patch, expected) => {
    expect(handbookSyncStatus({ ...synced, ...patch })).toBe(expected);
  });

  it("offers a pull only when the handbook may be newer", () => {
    expect(canPull("changed_in_handbook")).toBe(true);
    expect(canPull("both_changed")).toBe(true);
    expect(canPull("changed_in_hq")).toBe(false);
    expect(canPull("in_sync")).toBe(false);
  });
});
