import { and, asc, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { type z } from "zod";

import {
  type moveViewInput,
  parseStoredFilter,
  type renameViewInput,
  type SavedViewItem,
  type saveViewInput,
  type setViewSharedInput,
  type updateViewFilterInput,
  viewFilterOf,
} from "@/lib/views/saved-views";
import { directRead, type Read } from "@/server/db/read-batch";
import { projects, savedViews, users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { conflict, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { type IdRef } from "./sql";

const NAME_TAKEN = "You already have a view with that name";

/**
 * VW-3 saved views. Privacy is in every query: a view is READABLE by its owner, and by
 * everyone only when `shared`; it is CHANGEABLE (filter, name, sharing, order, delete) by
 * its owner only. Anything else behaves exactly like a missing view ("View not found"), so
 * an id reveals nothing. The user id always comes from the session (the action), never
 * from the input.
 *
 * Order is a per-owner `fractional-indexing` key (not unique, like `todos.position`); other
 * people's shared views are listed after the user's own, by name.
 */
export function createSavedViewService(
  db: AppDatabase,
  { read = directRead }: { read?: Read } = {},
) {
  const own = (userId: string, viewId: string) =>
    and(eq(savedViews.id, viewId), eq(savedViews.userId, userId));

  async function projectId(key: string) {
    const [row] = await read(
      db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1),
    );
    if (!row) throw notFound(`Project ${key}`);
    return row.id;
  }

  async function ownView(userId: string, viewId: string) {
    const [row] = await read(
      db
        .select({
          id: savedViews.id,
          projectId: savedViews.projectId,
          position: savedViews.position,
        })
        .from(savedViews)
        .where(own(userId, viewId))
        .limit(1),
    );
    if (!row) throw notFound("View");
    return row;
  }

  async function nameTaken<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const info = pgErrorInfo(error);
      if (
        info?.code === UNIQUE_VIOLATION &&
        info.constraint === "saved_views_user_project_name_unique"
      ) {
        throw conflict(NAME_TAKEN);
      }
      throw error;
    }
  }

  async function changeOwn(
    userId: string,
    viewId: string,
    values: Partial<typeof savedViews.$inferInsert>,
  ) {
    const rows = await nameTaken(() =>
      db.update(savedViews).set(values).where(own(userId, viewId)).returning({ id: savedViews.id }),
    );
    if (rows.length === 0) throw notFound("View");
  }

  return {
    /** The user's own views (in their order), then other people's shared views (by name). */
    async listViews(userId: string, project: IdRef): Promise<SavedViewItem[]> {
      const rows = await read(
        db
          .select({
            id: savedViews.id,
            name: savedViews.name,
            shared: savedViews.shared,
            filter: savedViews.filter,
            userId: savedViews.userId,
            ownerName: users.name,
          })
          .from(savedViews)
          .leftJoin(users, eq(users.id, savedViews.userId))
          .where(
            and(
              eq(savedViews.projectId, project),
              or(eq(savedViews.userId, userId), eq(savedViews.shared, true)),
            ),
          )
          .orderBy(
            sql`${savedViews.userId} = ${userId} DESC`,
            sql`CASE WHEN ${savedViews.userId} = ${userId} THEN ${savedViews.position} END`,
            asc(sql`lower(${savedViews.name})`),
            asc(savedViews.createdAt),
            asc(savedViews.id),
          ),
      );
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        shared: row.shared,
        mine: row.userId === userId,
        ownerName: row.ownerName,
        filter: parseStoredFilter(row.filter),
      }));
    },

    /** A view of this project the user may read (own, or shared), or null. */
    async getView(userId: string, project: IdRef, viewId: string): Promise<SavedViewItem | null> {
      const [row] = await read(
        db
          .select({
            id: savedViews.id,
            name: savedViews.name,
            shared: savedViews.shared,
            filter: savedViews.filter,
            userId: savedViews.userId,
            ownerName: users.name,
          })
          .from(savedViews)
          .leftJoin(users, eq(users.id, savedViews.userId))
          .where(
            and(
              eq(savedViews.id, viewId),
              eq(savedViews.projectId, project),
              or(eq(savedViews.userId, userId), eq(savedViews.shared, true)),
            ),
          )
          .limit(1),
      );
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        shared: row.shared,
        mine: row.userId === userId,
        ownerName: row.ownerName,
        filter: parseStoredFilter(row.filter),
      };
    },

    /** Saves the list's current filters under a name, below the user's last view. */
    async create(userId: string, input: z.output<typeof saveViewInput>): Promise<{ id: string }> {
      const project = await projectId(input.projectKey);
      const [last] = await db
        .select({ position: savedViews.position })
        .from(savedViews)
        .where(and(eq(savedViews.userId, userId), eq(savedViews.projectId, project)))
        .orderBy(desc(savedViews.position))
        .limit(1);
      const [row] = await nameTaken(() =>
        db
          .insert(savedViews)
          .values({
            userId,
            projectId: project,
            name: input.name,
            shared: input.shared,
            filter: viewFilterOf(new URLSearchParams(input.query)),
            position: generateKeyBetween(last?.position ?? null, null),
          })
          .returning({ id: savedViews.id }),
      );
      if (!row) throw new Error("saved view insert returned nothing");
      return { id: row.id };
    },

    /** "Update view": replaces the filter with the list's current one. */
    async updateFilter(userId: string, input: z.output<typeof updateViewFilterInput>) {
      await changeOwn(userId, input.viewId, {
        filter: viewFilterOf(new URLSearchParams(input.query)),
      });
    },

    async rename(userId: string, input: z.output<typeof renameViewInput>) {
      await changeOwn(userId, input.viewId, { name: input.name });
    },

    async setShared(userId: string, input: z.output<typeof setViewSharedInput>) {
      await changeOwn(userId, input.viewId, { shared: input.shared });
    },

    /** Views are settings, not content (no `deleted_at`), so delete is a real delete. */
    async remove(userId: string, viewId: string) {
      const rows = await db
        .delete(savedViews)
        .where(own(userId, viewId))
        .returning({ id: savedViews.id });
      if (rows.length === 0) throw notFound("View");
    },

    /** Moves the view right after `afterViewId` among the user's own (see `todos.move`). */
    async move(userId: string, input: z.output<typeof moveViewInput>) {
      const [view, prev] = await Promise.all([
        ownView(userId, input.viewId),
        input.afterViewId ? ownView(userId, input.afterViewId) : Promise.resolve(null),
      ]);
      if (prev && prev.projectId !== view.projectId) throw notFound("View");
      const prevPosition = prev?.position ?? null;
      const [successor] = await db
        .select({ position: savedViews.position })
        .from(savedViews)
        .where(
          and(
            eq(savedViews.userId, userId),
            eq(savedViews.projectId, view.projectId),
            ne(savedViews.id, view.id),
            prevPosition === null ? undefined : gt(savedViews.position, prevPosition),
          ),
        )
        .orderBy(asc(savedViews.position))
        .limit(1);
      const next = successor?.position ?? null;
      const current = view.position;
      if ((prevPosition === null || current > prevPosition) && (next === null || current < next)) {
        return;
      }
      await changeOwn(userId, view.id, { position: generateKeyBetween(prevPosition, next) });
    },
  };
}

export type SavedViewService = ReturnType<typeof createSavedViewService>;
