import "server-only";
import { prisma } from "@/lib/prisma";
import { indexEntity, deleteEntityEmbeddings } from "@/lib/vector";
import { AppError } from "@/lib/api-response";
import * as goalRepository from "@/repositories/goal-repository";
import type { GoalInput } from "@/repositories/goal-repository";
import { embeddableTextFor, goalRollupSummary } from "@/services/embeddable-text";
import type { GoalModel as Goal } from "@/generated/prisma/models";

// The rundown inside a goal's embedded text is ordered explicitly, and
// `reindex-service.ts` uses this same order. Without one, Postgres returns
// rows in whatever order it likes, and the rebuild path would be free to embed
// the same goal as different text than the write path did — which is exactly
// the drift `embeddable-text.ts` exists to prevent.
export const ROLLUP_ORDER = [{ createdAt: "asc" }, { id: "asc" }] as const;

async function syncGoalIndex(userId: string, goal: Goal): Promise<void> {
  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { userId, goalId: goal.id, deletedAt: null },
      select: { title: true, progress: true },
      orderBy: [...ROLLUP_ORDER],
    }),
    prisma.task.findMany({
      where: { userId, goalId: goal.id, deletedAt: null },
      select: { title: true, status: true },
      orderBy: [...ROLLUP_ORDER],
    }),
  ]);

  const rollup = goalRollupSummary(projects, tasks);

  try {
    await indexEntity(
      userId,
      "goal",
      goal.id,
      embeddableTextFor.goal(goal, rollup),
    );
  } catch (error) {
    console.error(`[WARN] Failed to index goal ${goal.id}:`, error);
    await deleteEntityEmbeddings(userId, "goal", goal.id).catch(() => {});
  }
}

/**
 * A goalId arriving from a form is client-supplied, the same reason
 * `assertProjectOwned` exists — the database would happily attach another
 * user's goal to a Project or Task otherwise.
 */
export async function assertGoalOwned(
  userId: string,
  goalId: string | null,
): Promise<void> {
  if (!goalId) return;

  const goal = await goalRepository.getGoal(userId, goalId);
  if (!goal) {
    throw new AppError("RESOURCE_NOT_FOUND", "That goal no longer exists.");
  }
}

/**
 * Progress is derived from every task the goal owns, directly or through a
 * linked project — the same "written only here" rule `recalculateProgress`
 * enforces for Project, one level up. Counting raw tasks rather than
 * averaging each linked project's own percentage keeps a goal with one
 * ten-task project from being skewed by a second, one-task project the same
 * way averaging percentages would.
 */
export async function recalculateGoalProgress(
  userId: string,
  goalId: string | null | undefined,
): Promise<void> {
  if (!goalId) return;

  const goal = await goalRepository.getGoal(userId, goalId);
  if (!goal) return;

  const tasks = await prisma.task.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [{ goalId }, { project: { is: { goalId, deletedAt: null } } }],
    },
    select: { status: true },
  });

  const done = tasks.filter((task) => task.status === "done").length;
  const progress =
    tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);

  if (progress !== goal.progress) {
    await goalRepository.setProgress(userId, goalId, progress);
  }

  await syncGoalIndex(userId, { ...goal, progress });
}

export async function createGoal(
  userId: string,
  input: GoalInput,
): Promise<Goal> {
  const goal = await goalRepository.createGoal(userId, input);
  await syncGoalIndex(userId, goal);
  return goal;
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: GoalInput,
): Promise<Goal> {
  const goal = await goalRepository.updateGoal(userId, goalId, input);
  if (!goal) {
    throw new AppError("RESOURCE_NOT_FOUND", "That goal no longer exists.");
  }
  await syncGoalIndex(userId, goal);
  return goal;
}

/**
 * Soft-deletes the goal and detaches its projects and tasks rather than
 * cascading — the same reasoning `deleteProject` already applies one level
 * down: losing a goal must never silently take the user's projects and tasks
 * with it.
 */
export async function deleteGoal(userId: string, goalId: string): Promise<void> {
  const deleted = await goalRepository.softDeleteGoal(userId, goalId);
  if (!deleted) {
    throw new AppError("RESOURCE_NOT_FOUND", "That goal no longer exists.");
  }

  await prisma.$transaction([
    prisma.project.updateMany({
      where: { userId, goalId },
      data: { goalId: null },
    }),
    prisma.task.updateMany({
      where: { userId, goalId },
      data: { goalId: null },
    }),
  ]);

  await deleteEntityEmbeddings(userId, "goal", goalId);
}

/**
 * Undoes `deleteGoal` as far as it can be undone. Deleting detached the
 * goal's projects and tasks by nulling their `goalId`, and that association
 * is not recorded anywhere else — so a restored goal comes back with nothing
 * linked.
 *
 * Its stored `progress` has to be recomputed to say so. Deleting leaves that
 * column exactly as it was, so a goal deleted at 100% would otherwise return
 * showing 100% for work that is no longer attached to it.
 */
export async function restoreGoal(userId: string, goalId: string): Promise<Goal> {
  const restored = await goalRepository.restoreGoal(userId, goalId);
  if (!restored) {
    throw new AppError("RESOURCE_NOT_FOUND", "That goal is not in the trash.");
  }

  // Also re-syncs the search index, with the corrected figure in its text.
  await recalculateGoalProgress(userId, goalId);
  return (await goalRepository.getGoal(userId, goalId)) ?? restored;
}

export async function purgeGoal(userId: string, goalId: string): Promise<void> {
  const purged = await goalRepository.purgeGoal(userId, goalId);
  if (!purged) {
    throw new AppError("RESOURCE_NOT_FOUND", "That goal is not in the trash.");
  }
}
