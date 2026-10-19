import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("GitHub webhook placeholder (GH-1, Phase 2)", () => {
  it("answers 501 and processes nothing until signature verification exists", async () => {
    const response = POST();
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "not_implemented" });
  });
});
