import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_QUERY_MAX } from "@/lib/search/schemas";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const planningService = vi.hoisted(() => ({ moveIssue: vi.fn(), recordIssueView: vi.fn() }));
const todoService = vi.hoisted(() => ({
  add: vi.fn(),
  edit: vi.fn(),
  setDone: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
}));
const issueService = vi.hoisted(() => ({ createIssue: vi.fn() }));
const searchService = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/server/services", () => ({
  planningService,
  todoService,
  issueService,
  searchService,
}));

const planning = await import("./planning");
const todos = await import("./todos");
const search = await import("./search");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const USER = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const OTHER = "0f1e2d3c-4b5a-4968-8776-5544332211aa";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: USER, name: "Test Staff", email: "staff@example.test" },
};

type AnyAction = (input: unknown) => Promise<unknown>;
const cases: [string, AnyAction, unknown][] = [
  ["moveIssueAction", planning.moveIssueAction, { issueId: OTHER, afterIssueId: null }],
  ["recordIssueViewAction", planning.recordIssueViewAction, { issueId: OTHER }],
  ["addTodoAction", todos.addTodoAction, { text: "write it down" }],
  ["editTodoAction", todos.editTodoAction, { todoId: OTHER, text: "x" }],
  ["setTodoDoneAction", todos.setTodoDoneAction, { todoId: OTHER, done: true }],
  ["deleteTodoAction", todos.deleteTodoAction, { todoId: OTHER }],
  ["moveTodoAction", todos.moveTodoAction, { todoId: OTHER, afterTodoId: null }],
  ["promoteTodoAction", todos.promoteTodoAction, { todoId: OTHER, projectKey: "STK", title: "x" }],
  ["searchAction", search.searchAction, { q: "outbox" }],
];

const allMocks = () => [
  ...Object.values(planningService),
  ...Object.values(todoService),
  ...Object.values(issueService),
  ...Object.values(searchService),
];

describe("planning, todo and search server actions", () => {
  beforeEach(() => {
    authMock.mockReset();
    for (const mock of allMocks()) mock.mockReset().mockResolvedValue({});
  });

  it.each(cases)(
    "%s refuses without a session and touches nothing",
    async (_name, action, input) => {
      authMock.mockResolvedValue(null);
      await expect(action(input)).rejects.toBeInstanceOf(UnauthorizedError);
      for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
    },
  );

  it.each(cases)("%s rejects malformed input before the service", async (_name, action) => {
    authMock.mockResolvedValue(session);
    await expect(
      action({ issueId: "nope", todoId: 1, text: "", q: 5, afterIssueId: "x" }),
    ).resolves.toMatchObject({ ok: false });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it.each(cases)("%s succeeds with valid input", async (_name, action, input) => {
    authMock.mockResolvedValue(session);
    await expect(action(input)).resolves.toMatchObject({ ok: true });
  });

  it("scopes every todo action to the session user, ignoring any user id in the input", async () => {
    authMock.mockResolvedValue(session);
    await todos.addTodoAction({ text: "mine", userId: OTHER });
    await todos.editTodoAction({ todoId: OTHER, text: "x", userId: OTHER });
    await todos.setTodoDoneAction({ todoId: OTHER, done: true, userId: OTHER });
    await todos.deleteTodoAction({ todoId: OTHER, userId: OTHER });
    await todos.moveTodoAction({ todoId: OTHER, afterTodoId: null, userId: OTHER });
    for (const mock of Object.values(todoService)) {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0]?.[0]).toBe(USER);
      expect(JSON.stringify(mock.mock.calls[0]?.[1] ?? {})).not.toContain("userId");
    }
  });

  it("promotes through createIssue as the session user with the todo id", async () => {
    authMock.mockResolvedValue(session);
    await todos.promoteTodoAction({ todoId: OTHER, projectKey: "STK", title: "  Do  it " });
    expect(issueService.createIssue).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ projectKey: "STK", title: "Do it", type: "task", priority: 2 }),
      { promoteTodoId: OTHER },
    );
    expect(issueService.createIssue.mock.calls[0]?.[1]).not.toHaveProperty("todoId");
  });

  it("caps the search query length and trims it", async () => {
    authMock.mockResolvedValue(session);
    await expect(search.searchAction({ q: "x".repeat(SEARCH_QUERY_MAX + 1) })).resolves.toEqual({
      ok: false,
      error: "Search text is too long",
    });
    expect(searchService.search).not.toHaveBeenCalled();
    await search.searchAction({ q: "  outbox  dispatch " });
    expect(searchService.search).toHaveBeenCalledWith("outbox dispatch");
  });
});
