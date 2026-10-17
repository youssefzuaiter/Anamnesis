import "server-only";
import { prisma } from "@/lib/prisma";
import type { TaskModel as Task } from "@/generated/prisma/models";

export { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/domain";
export type { TaskStatus, TaskPriority } from "@/lib/domain";

import type { TaskStatus, TaskPriority } from "@/lib/domain";

export type TaskInput = {
  title: string;
  description: string | null;
  priority: TaskPriority;
  tags: string[];
  dueDate: Date | null;
  estimatedMinutes: number;
  projectId: string | null;
  courseId: string | null;
  goalId: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  recurrenceId?: string | null;
};

export async function listTasks(
  userId: string,
  options: { includeDone?: boolean; tag?: string } = {},
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(options.tag ? { tags: { has: options.tag } } : {}),
      ...(options.includeDone ? {} : { status: { not: "done" } }),
    },
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
  });
}

export async function getTask(
  userId: string,
  taskId: string,
): Promise<Task | null> {
  return prisma.task.findFirst({
    where: { id: taskId, userId, deletedAt: null },
  });
}

export async function createTask(
  userId: string,
  input: TaskInput,
): Promise<Task> {
  return prisma.task.create({ data: { ...input, userId } });
}

export async function updateTask(
  userId: string,
  taskId: string,
  input: TaskInput,
): Promise<Task | null> {
  const { count } = await prisma.task.updateMany({
    where: { id: taskId, userId, deletedAt: null },
    data: input,
  });
  if (count === 0) return null;
  return getTask(userId, taskId);
}

export async function setTaskStatus(
  userId: string,
  taskId: string,
  status: TaskStatus,
): Promise<Task | null> {
  const { count } = await prisma.task.updateMany({
    where: { id: taskId, userId, deletedAt: null },
    data: {
      status,
      // completedAt is derived from status, never set independently, so the two
      // cannot drift apart.
      completedAt: status === "done" ? new Date() : null,
    },
  });
  if (count === 0) return null;
  return getTask(userId, taskId);
}

export async function softDeleteTask(
  userId: string,
  taskId: string,
): Promise<boolean> {
  const { count } = await prisma.task.updateMany({
    where: { id: taskId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0;
}

export type DeletedTask = Pick<Task, "id" | "title" | "deletedAt">;

export async function listDeletedTasks(userId: string): Promise<DeletedTask[]> {
  return prisma.task.findMany({
    where: { userId, deletedAt: { not: null } },
    select: { id: true, title: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });
}

export async function restoreTask(
  userId: string,
  taskId: string,
): Promise<Task | null> {
  const { count } = await prisma.task.updateMany({
    where: { id: taskId, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (count === 0) return null;
  return getTask(userId, taskId);
}

/** Permanent. Only ever called on a row that is already soft-deleted. */
export async function purgeTask(
  userId: string,
  taskId: string,
): Promise<boolean> {
  const { count } = await prisma.task.deleteMany({
    where: { id: taskId, userId, deletedAt: { not: null } },
  });
  return count > 0;
}

/** Ids of this and every later occurrence in the same recurring series. */
export async function listSeriesTaskIds(
  userId: string,
  recurrenceId: string,
  from: Date,
): Promise<string[]> {
  const rows = await prisma.task.findMany({
    where: { userId, recurrenceId, deletedAt: null, dueDate: { gte: from } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Open tasks with no time block yet — the calendar's drag-to-schedule tray. */
export async function listUnscheduled(userId: string, limit = 20): Promise<Task[]> {
  return prisma.task.findMany({
    where: { userId, deletedAt: null, status: { not: "done" }, scheduledStart: null },
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: limit,
  });
}

/**
 * Tasks whose scheduled block overlaps the window at all, so a block spanning
 * midnight still shows on both days.
 */
export async function listScheduledInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      userId,
      deletedAt: null,
      scheduledStart: { lt: to },
      scheduledEnd: { gt: from },
    },
    orderBy: { scheduledStart: "asc" },
  });
}

/** Every distinct tag in use, for the filter bar. */
export async function listTaskTags(userId: string): Promise<string[]> {
  const rows = await prisma.task.findMany({
    where: { userId, deletedAt: null },
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((row) => row.tags))].sort();
}

export async function countOpenTasks(userId: string): Promise<number> {
  return prisma.task.count({
    where: { userId, deletedAt: null, status: { not: "done" } },
  });
}
