import { describe, expect, it } from "vitest";

import { allInOrder } from "./parallel";

const later = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const failLater = (ms: number, message: string) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms));

describe("allInOrder", () => {
  it("resolves like Promise.all", async () => {
    expect(await allInOrder([later(5, 1), later(1, "two")])).toEqual([1, "two"]);
  });

  it("throws the first failure in ARRAY order, not the first to settle", async () => {
    await expect(
      allInOrder([failLater(20, "Issue not found"), failLater(1, "Status not found")]),
    ).rejects.toThrow("Issue not found");
  });
});
