import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const docExportQueries = vi.hoisted(() => ({ markdownFile: vi.fn() }));
vi.mock("@/server/services", () => ({ docExportQueries }));

const { GET } = await import("./route");

const ID = "11111111-2222-4333-8444-555555555555";
const session: Session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: { id: "hq-1", name: "Test Staff", email: "staff@example.test" },
};
const file = {
  path: "decisions/0042-cache.md",
  fileName: "0042-cache.md",
  markdown: "# 0042. Cache\n\n## Status\n\n`Accepted`.\n",
};

const get = (projectKey: string, id: string) =>
  GET(new Request(`http://hq.test/${projectKey}/docs/${id}/export`), {
    params: Promise.resolve({ projectKey, id }),
  });

describe("GET /[projectKey]/docs/[id]/export (DOC-12)", () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(session);
    docExportQueries.markdownFile.mockReset().mockResolvedValue(file);
  });

  it("answers 401 without a session and never reads the doc", async () => {
    authMock.mockResolvedValue(null);
    const response = await get("STK", ID);
    expect(response.status).toBe(401);
    expect(docExportQueries.markdownFile).not.toHaveBeenCalled();
  });

  it("downloads the doc as its handbook file, uncached", async () => {
    const response = await get("stk", ID.toUpperCase());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="0042-cache.md"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe(file.markdown);
    expect(docExportQueries.markdownFile).toHaveBeenCalledWith("STK", ID);
  });

  it("answers the same uncached 404 for a missing or deleted doc", async () => {
    docExportQueries.markdownFile.mockResolvedValue(null);
    const response = await get("STK", ID);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "not_found", message: "Doc not found" });
  });

  it.each([
    ["a bad id", "STK", "not-a-uuid"],
    ["a bad project key", "S1", ID],
    ["a path in the key", "../STK", ID],
  ])("answers 404 for %s without a query", async (_name, projectKey, id) => {
    const response = await get(projectKey, id);
    expect(response.status).toBe(404);
    expect(docExportQueries.markdownFile).not.toHaveBeenCalled();
  });
});
