import { describe, expect, it } from "vitest";

import { type AppDatabase } from "@/server/db/types";

import {
  createNotificationService,
  notificationDedupeKey,
  notificationRecipients,
  type NotifyInput,
} from "./notifications";

const ALICE = "AAAAAAAA-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";

describe("notify() skeleton (NTF-1)", () => {
  it("accepts the shared input and writes nothing yet", async () => {
    // The skeleton never touches the database; an empty stand-in proves it.
    const service = createNotificationService({} as unknown as AppDatabase);
    const input: NotifyInput = {
      type: "assigned",
      recipients: [BOB],
      actorId: ALICE,
      entity: { type: "issue", id: "cccccccc-0000-4000-8000-000000000003" },
      meta: { issueKey: "STK-1" },
      dedupeKey: "assigned:act-1",
    };
    await expect(service.notify(input)).resolves.toEqual({ created: 0 });
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
