import { describe, expect, it, vi } from "vitest";

import { type AppDatabase } from "@/server/db/types";

import {
  createNotificationService,
  notificationDedupeKey,
  notificationRecipients,
  notifySafely,
  type NotifyInput,
} from "./notifications";

const ALICE = "AAAAAAAA-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";

describe("notify() (NTF-1)", () => {
  const input: NotifyInput = {
    type: "assigned",
    recipients: [BOB],
    actorId: ALICE,
    entity: { type: "issue", id: "cccccccc-0000-4000-8000-000000000003" },
    meta: { issueKey: "STK-1" },
    dedupeKey: "assigned:act-1",
  };

  it("does not touch the database when only the actor is left", async () => {
    // An empty stand-in: any database call would throw.
    const service = createNotificationService({} as unknown as AppDatabase);
    await expect(service.notify({ ...input, recipients: [ALICE] })).resolves.toEqual({
      created: 0,
    });
  });

  it("notifySafely logs a failure and never throws (the user's action goes on)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(notifySafely(failing, input)).resolves.toEqual({ created: 0 });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("[notify] assigned for issue"),
      "db down",
    );
    // The log names the event, not its details.
    expect(JSON.stringify(error.mock.calls)).not.toContain("STK-1");
  });

  it("drops duplicates and the actor from the recipients", () => {
    expect(
      notificationRecipients({ recipients: [BOB, ALICE, BOB.toUpperCase()], actorId: ALICE }),
    ).toEqual([BOB]);
    expect(notificationRecipients({ recipients: [ALICE], actorId: null })).toEqual([
      ALICE.toLowerCase(),
    ]);
  });

  it("derives one dedupe key per recipient", () => {
    expect(notificationDedupeKey("assigned:act-1", ALICE)).toBe(
      `assigned:act-1:${ALICE.toLowerCase()}`,
    );
    expect(notificationDedupeKey(undefined, ALICE)).toBeNull();
  });
});
