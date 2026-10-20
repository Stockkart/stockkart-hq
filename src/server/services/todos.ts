import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { formatIssueKey, issuePath } from "@/lib/issues/keys";
import {
  type addTodoInput,
  type editTodoInput,
  type moveTodoInput,
  type setTodoDoneInput,
} from "@/lib/todos/schemas";
import { issues, projects, todos } from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { notFound } from "./errors";
import { rowsOf } from "./sql";

export interface TodoView {
  id: string;
  text: string;
  done: boolean;
  position: string;
  /**
   * MY-3: the issue this todo was promoted to. A soft-deleted issue keeps the link (ISS-13
   * restore brings it back) and is flagged, so the todo cannot be promoted twice.
   */
  promotedIssue: { key: string; href: string; deleted: boolean } | null;
}

/**
 * MY-2 personal todos. Strictly private: every query and write is scoped to `userId` (the
 * session user, passed by the action), and a todo of another user behaves exactly like a
 * missing one ("Todo not found"), so ids reveal nothing.
 *
 * Order is a `fractional-indexing` key per user, like `issues.rank`, but not unique: todos
 * are private, so the only race is one user's two tabs. Equal keys are harmless (ties sort
 * by creation time), and moves only ever pick a key strictly between distinct neighbours.
 */
export function createTodoService(db: AppDatabase, { read = directRead }: { read?: Read } = {}) {
  const own = (userId: string, todoId: string) =>
    and(eq(todos.id, todoId), eq(todos.userId, userId));

  async function positionOf(userId: string, todoId: string): Promise<string | null> {
    const [row] = await read(
      db.select({ position: todos.position }).from(todos).where(own(userId, todoId)).limit(1),
    );
    return row?.position ?? null;
  }

  return {
    async list(userId: string): Promise<TodoView[]> {
      const rows = await read(
        db
          .select({
            id: todos.id,
            text: todos.text,
            done: todos.done,
            position: todos.position,
            issueNumber: issues.number,
            issueDeletedAt: issues.deletedAt,
            projectKey: projects.key,
          })
          .from(todos)
          .leftJoin(issues, eq(issues.id, todos.promotedIssueId))
          .leftJoin(projects, eq(projects.id, issues.projectId))
          .where(eq(todos.userId, userId))
          .orderBy(asc(todos.position), asc(todos.createdAt), asc(todos.id)),
      );
      return rows.map((row) => ({
        id: row.id,
        text: row.text,
        done: row.done,
        position: row.position,
        promotedIssue:
          row.issueNumber !== null && row.projectKey !== null
            ? {
                key: formatIssueKey(row.projectKey, row.issueNumber),
                href: issuePath(row.projectKey, row.issueNumber),
                deleted: row.issueDeletedAt !== null,
              }
            : null,
      }));
    },

    /** Quick add (MY-2): appended below the user's last todo. */
    async add(userId: string, input: z.output<typeof addTodoInput>): Promise<{ id: string }> {
      const [last] = await db
        .select({ position: todos.position })
        .from(todos)
        .where(eq(todos.userId, userId))
        .orderBy(desc(todos.position))
        .limit(1);
      const [row] = await db
        .insert(todos)
        .values({
          userId,
          text: input.text,
          position: generateKeyBetween(last?.position ?? null, null),
        })
        .returning({ id: todos.id });
      if (!row) throw new Error("todo insert returned nothing");
      return { id: row.id };
    },

    async edit(userId: string, input: z.output<typeof editTodoInput>): Promise<void> {
      const rows = await db
        .update(todos)
        .set({ text: input.text })
        .where(own(userId, input.todoId))
        .returning({ id: todos.id });
      if (rows.length === 0) throw notFound("Todo");
    },

    async setDone(userId: string, input: z.output<typeof setTodoDoneInput>): Promise<void> {
      const rows = await db
        .update(todos)
        .set({ done: input.done })
        .where(own(userId, input.todoId))
        .returning({ id: todos.id });
      if (rows.length === 0) throw notFound("Todo");
    },

    /** Todos are private scratch notes (no `deleted_at`), so delete is a real delete. */
    async remove(userId: string, todoId: string): Promise<void> {
      const rows = await db.delete(todos).where(own(userId, todoId)).returning({ id: todos.id });
      if (rows.length === 0) throw notFound("Todo");
    },

    /** Moves a todo to just after `afterTodoId` (or the top); see `moveIssue`. */
    async move(userId: string, input: z.output<typeof moveTodoInput>): Promise<void> {
      // Both positions in one round trip.
      const [current, prev] = await Promise.all([
        positionOf(userId, input.todoId),
        input.afterTodoId ? positionOf(userId, input.afterTodoId) : Promise.resolve(null),
      ]);
      if (current === null) throw notFound("Todo");
      if (input.afterTodoId && prev === null) throw notFound("Todo");
      // The predecessor's true successor among this user's todos (strictly greater, so a
      // tie with the predecessor can never make the key range empty).
      const [successor] = await db
        .select({ position: todos.position })
        .from(todos)
        .where(
          and(
            eq(todos.userId, userId),
            ne(todos.id, input.todoId),
            prev === null ? undefined : gt(todos.position, prev),
          ),
        )
        .orderBy(asc(todos.position))
        .limit(1);
      const next = successor?.position ?? null;
      if ((prev === null || current > prev) && (next === null || current < next)) return;
      const position = generateKeyBetween(prev, next);
      const result = await db.execute(sql`
        UPDATE todos SET position = ${position}, updated_at = now()
        WHERE id = ${input.todoId}::uuid AND user_id = ${userId}::uuid
        RETURNING id
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Todo");
    },
  };
}

export type TodoService = ReturnType<typeof createTodoService>;
