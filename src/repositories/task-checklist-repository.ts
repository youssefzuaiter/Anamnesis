import "server-only";
import { prisma } from "@/lib/prisma";
import { afterCreated, type ExportPage } from "@/lib/export-shape";
import type { Positioned } from "@/lib/checklist";
import type { TaskChecklistItemModel as ChecklistItem } from "@/generated/prisma/models";

/**
 * Every read and write here carries the caller's `userId` and requires the step's task to be live (not in
 * the trash): the steps of a trashed task are kept, but nothing reads or changes them until it is restored.
 */
const live = (userId: string) => ({ userId, task: { deletedAt: null } });

export async function listForTask(userId: string, taskId: string): Promise<ChecklistItem[]> {
  return prisma.taskChecklistItem.findMany({
    where: { ...live(userId), taskId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export async function countForTask(userId: string, taskId: string): Promise<number> {
  return prisma.taskChecklistItem.count({ where: { ...live(userId), taskId } });
}

/** Done and total for each of these tasks that has any steps, in one grouped read. */
export async function countsForTasks(userId: string, taskIds: string[]): Promise<Map<string, { done: number; total: number }>> {
  const counts = new Map<string, { done: number; total: number }>();
  if (taskIds.length === 0) return counts;
  const rows = await prisma.taskChecklistItem.groupBy({
    by: ["taskId", "done"],
    where: { ...live(userId), taskId: { in: taskIds } },
    _count: { _all: true },
  });
  for (const row of rows) {
    const entry = counts.get(row.taskId) ?? { done: 0, total: 0 };
    entry.total += row._count._all;
    if (row.done) entry.done += row._count._all;
    counts.set(row.taskId, entry);
  }
  return counts;
}

export async function create(userId: string, taskId: string, title: string, position: number): Promise<ChecklistItem> {
  return prisma.taskChecklistItem.create({ data: { userId, taskId, title, position } });
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
