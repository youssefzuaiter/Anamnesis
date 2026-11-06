import "server-only";
import { prisma } from "@/lib/prisma";
import { afterCreated, type ExportPage } from "@/lib/export-shape";
import { nextPosition, type Positioned } from "@/lib/checklist";
import type { TaskChecklistItemModel as ChecklistItem } from "@/generated/prisma/models";

/**
 * Every read and write here carries the caller's `userId` and requires the step's task to be live (not in
 * the trash): the steps of a trashed task are kept, but nothing reads or changes them until it is restored.
 */
const live = (userId: string) => ({ userId, task: { deletedAt: null } });

export async function listForTask(userId: string, taskId: string): Promise<ChecklistItem[]> {
  return prisma.taskChecklistItem.findMany({
    where: { ...live(userId), taskId },
    // The order a move works in (`moveItem` in lib/checklist.ts): position, then id for steps that share one.
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
}

export async function countForTask(userId: string, taskId: string): Promise<number> {
  return prisma.taskChecklistItem.count({ where: { ...live(userId), taskId } });
}

/** Most ids one query is given: Postgres refuses more than 32,767 parameters, and 5,000 take about 14 ms. */
const ID_CHUNK = 5000;

/** Done and total for each of these tasks that has any steps, a grouped read for each 5,000 ids. */
export async function countsForTasks(userId: string, taskIds: string[]): Promise<Map<string, { done: number; total: number }>> {
  const counts = new Map<string, { done: number; total: number }>();
  const ids = [...new Set(taskIds)];
  for (let from = 0; from < ids.length; from += ID_CHUNK) {
    const rows = await prisma.taskChecklistItem.groupBy({
      by: ["taskId", "done"],
      where: { ...live(userId), taskId: { in: ids.slice(from, from + ID_CHUNK) } },
      _count: { _all: true },
    });
    for (const row of rows) {
      const entry = counts.get(row.taskId) ?? { done: 0, total: 0 };
      entry.total += row._count._all;
      if (row.done) entry.done += row._count._all;
      counts.set(row.taskId, entry);
    }
  }
  return counts;
}

export type AddResult = { kind: "created"; item: ChecklistItem } | { kind: "full" } | { kind: "missing" };

/**
 * Adds a step at the end of a live task of the caller's, unless it already holds `limit`. The task's row is
 * locked until the transaction ends, so adds to one task take turns: without it the count was read and the row
 * written in two steps, and 60 adds at once on a list of 49 stored 109.
 */
export async function createIfRoom(userId: string, taskId: string, title: string, limit: number): Promise<AddResult> {
  return prisma.$transaction(async (tx): Promise<AddResult> => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Task" WHERE "id" = ${taskId} AND "userId" = ${userId} AND "deletedAt" IS NULL FOR UPDATE`;
    if (locked.length === 0) return { kind: "missing" };
    const existing = await tx.taskChecklistItem.findMany({ where: { taskId, userId }, select: { position: true } });
    if (existing.length >= limit) return { kind: "full" };
    return { kind: "created", item: await tx.taskChecklistItem.create({ data: { userId, taskId, title, position: nextPosition(existing) } }) };
  });
}

export async function getItem(userId: string, itemId: string): Promise<ChecklistItem | null> {
  return prisma.taskChecklistItem.findFirst({ where: { ...live(userId), id: itemId } });
}

export async function update(userId: string, itemId: string, data: { title?: string; done?: boolean }): Promise<boolean> {
  const { count } = await prisma.taskChecklistItem.updateMany({ where: { ...live(userId), id: itemId }, data });
  return count > 0;
}

export async function remove(userId: string, itemId: string): Promise<boolean> {
  const { count } = await prisma.taskChecklistItem.deleteMany({ where: { ...live(userId), id: itemId } });
  return count > 0;
}

/** Writes the new positions of one task's steps together, each write scoped by the user and the task. */
export async function writePositions(userId: string, taskId: string, rows: Positioned[]): Promise<void> {
  if (rows.length === 0) return;
  await prisma.$transaction(
    rows.map((row) => prisma.taskChecklistItem.updateMany({ where: { id: row.id, taskId, userId }, data: { position: row.position } })),
  );
}

/** A page of the caller's steps of live tasks, for the JSON export; oldest first, ties by id. */
export async function listLiveForExport(userId: string, page: ExportPage): Promise<ChecklistItem[]> {
  return prisma.taskChecklistItem.findMany({
    where: { AND: [live(userId), afterCreated(page.after)] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: page.take,
  });
}
