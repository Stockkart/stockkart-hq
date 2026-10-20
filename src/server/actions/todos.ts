"use server";

import { revalidatePath } from "next/cache";
import { type z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import {
  addTodoInput,
  editTodoInput,
  moveTodoInput,
  promoteTodoInput,
  setTodoDoneInput,
  todoIdInput,
} from "@/lib/todos/schemas";
import { requireSession } from "@/server/auth/require-session";
import { issueService, todoService } from "@/server/services";
import { type CreatedIssue } from "@/server/services/issues";

import { runAction } from "./action-runner";

/**
 * Personal todos (MY-2, MY-3). The owner is ALWAYS the session user: no action accepts a
 * user id, and the service scopes every query to it, so one user can never read or change
 * another user's todos by sending their ids.
 */

function refreshTodos() {
  revalidatePath("/todos");
}

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  action: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAction(schema, input, action, refreshTodos);
}

export async function addTodoAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return run(addTodoInput, input, (data) => todoService.add(session.user.id, data));
}

export async function editTodoAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(editTodoInput, input, async (data) => {
    await todoService.edit(session.user.id, data);
    return undefined;
  });
}

export async function setTodoDoneAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(setTodoDoneInput, input, async (data) => {
    await todoService.setDone(session.user.id, data);
    return undefined;
  });
}

export async function deleteTodoAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(todoIdInput, input, async (data) => {
    await todoService.remove(session.user.id, data.todoId);
    return undefined;
  });
}

export async function moveTodoAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(moveTodoInput, input, async (data) => {
    await todoService.move(session.user.id, data);
    return undefined;
  });
}

/** MY-3: creates the issue and links the todo to it in one statement (see `createIssue`). */
export async function promoteTodoAction(input: unknown): Promise<ActionResult<CreatedIssue>> {
  const session = await requireSession();
  return runAction(
    promoteTodoInput,
    input,
    ({ todoId, ...issue }) =>
      issueService.createIssue(session.user.id, issue, { promoteTodoId: todoId }),
    () => {
      refreshTodos();
      revalidatePath("/[projectKey]", "layout");
      revalidatePath("/my-work");
    },
  );
}
