import { z } from "zod";

import { createIssueInput } from "@/lib/issues/schemas";

/** Zod input schemas for the personal todo actions (MY-2, MY-3). */

export const TODO_TEXT_MAX = 500;

const text = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Write something first").max(TODO_TEXT_MAX, "Todo is too long"));
const todoId = z.uuid();

export const addTodoInput = z.object({ text });
export const editTodoInput = z.object({ todoId, text });
export const setTodoDoneInput = z.object({ todoId, done: z.boolean() });
export const todoIdInput = z.object({ todoId });
/** Put `todoId` right after `afterTodoId` (null = the top); see `moveIssueInput`. */
export const moveTodoInput = z
  .object({ todoId, afterTodoId: z.uuid().nullable() })
  .refine((value) => value.todoId !== value.afterTodoId, "A todo cannot follow itself");

/** MY-3: the quick-create fields plus the todo the new issue is promoted from. */
export const promoteTodoInput = createIssueInput.extend({ todoId });
