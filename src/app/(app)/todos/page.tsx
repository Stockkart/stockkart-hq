import type { Metadata } from "next";

import { TodoList } from "@/features/todos/todo-list";
import { requirePageSession } from "@/server/auth/require-session";
import { todoService } from "@/server/services";

export const metadata: Metadata = { title: "Todos" };

/** MY-2/3: the signed-in user's own todos (the `points.txt` replacement). */
export default async function TodosPage() {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  // Scoped to the session user; nobody else's todos are ever read here.
  const todos = await todoService.list(session.user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Todos</h1>
        <p className="text-sm text-muted-foreground">
          Private to you. Promote a todo when it becomes real work.
        </p>
      </div>
      <TodoList
        todos={todos.map(({ id, text, done, promotedIssue }) => ({
          id,
          text,
          done,
          promotedIssue,
        }))}
      />
    </div>
  );
}
