import "server-only";
import { prisma } from "@/lib/prisma";
import type { GoalModel as Goal } from "@/generated/prisma/models";

export type { ProjectCategory, GoalOption } from "@/lib/domain";

import type { ProjectCategory } from "@/lib/domain";

export type GoalInput = {
  title: string;
  description: string | null;
  category: ProjectCategory;
  targetDate: Date | null;
};

export type GoalSummary = Goal & {
  counts: { projects: number; tasks: number };
};

export async function listGoals(userId: string): Promise<GoalSummary[]> {
  const goals = await prisma.goal.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          projects: { where: { deletedAt: null } },
          tasks: { where: { deletedAt: null } },
        },
      },
    },
  });

  return goals.map(({ _count, ...goal }) => ({
    ...goal,
    counts: { projects: _count.projects, tasks: _count.tasks },
  }));
}

export async function listGoalOptions(
  userId: string,
): Promise<{ id: string; title: string }[]> {
  return prisma.goal.findMany({
    where: { userId, deletedAt: null },
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });
}

export async function getGoal(
  userId: string,
  goalId: string,
): Promise<Goal | null> {
  return prisma.goal.findFirst({
    where: { id: goalId, userId, deletedAt: null },
  });
}

export async function createGoal(
  userId: string,
  input: GoalInput,
): Promise<Goal> {
  return prisma.goal.create({ data: { ...input, userId } });
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: GoalInput,
): Promise<Goal | null> {
  const { count } = await prisma.goal.updateMany({
    where: { id: goalId, userId, deletedAt: null },
    data: input,
  });
  if (count === 0) return null;
  return getGoal(userId, goalId);
}

export async function softDeleteGoal(
  userId: string,
  goalId: string,
): Promise<boolean> {
  const { count } = await prisma.goal.updateMany({
    where: { id: goalId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0;
}

export type DeletedGoal = Pick<Goal, "id" | "title" | "deletedAt">;

export async function listDeletedGoals(
  userId: string,
): Promise<DeletedGoal[]> {
  return prisma.goal.findMany({
    where: { userId, deletedAt: { not: null } },
    select: { id: true, title: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });
}

export async function restoreGoal(
  userId: string,
  goalId: string,
): Promise<Goal | null> {
  const { count } = await prisma.goal.updateMany({
    where: { id: goalId, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (count === 0) return null;
  return getGoal(userId, goalId);
}

/** Permanent. Only ever called on a row that is already soft-deleted. */
export async function purgeGoal(
  userId: string,
  goalId: string,
): Promise<boolean> {
  const { count } = await prisma.goal.deleteMany({
    where: { id: goalId, userId, deletedAt: { not: null } },
  });
  return count > 0;
}

export async function setProgress(
  userId: string,
  goalId: string,
  progress: number,
): Promise<void> {
  await prisma.goal.updateMany({
    where: { id: goalId, userId, deletedAt: null },
    data: { progress },
  });
}

/**
 * A goal's own contents: Projects linked directly to it, and Tasks linked
 * directly to it (not the tasks belonging to those projects — mirroring how
 * `getProjectContents` returns a project's own notes/tasks/events rather than
 * anything nested further). `recalculateGoalProgress` in `goal-service.ts` is
 * the one place the deeper, task-level rollup actually happens.
 */
export async function getGoalContents(userId: string, goalId: string) {
  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { userId, goalId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, category: true, progress: true },
    }),
    prisma.task.findMany({
      where: { userId, goalId, deletedAt: null },
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    }),
  ]);

  return { projects, tasks };
}

/**
 * The true done/total this goal's `progress` percentage is actually computed
 * from — direct tasks plus every task under a linked project, the same query
 * `recalculateGoalProgress` runs to derive the stored percentage. Exists so
 * the goal page can show an honest fraction next to that percentage: showing
 * only direct-task counts there would read as "1/1" beside "67%" the moment
 * any task rolls up through a linked project instead.
 */
export async function getGoalTaskTotals(
  userId: string,
  goalId: string,
): Promise<{ done: number; total: number }> {
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [{ goalId }, { project: { is: { goalId, deletedAt: null } } }],
    },
    select: { status: true },
  });

  return {
    done: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
  };
}
