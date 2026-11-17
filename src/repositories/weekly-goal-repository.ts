import "server-only";
import { prisma } from "@/lib/prisma";
import type { WeeklyGoal } from "@/generated/prisma/client";

/** Every query here is scoped by the session's userId; writes put it in the `where` itself. */

export function listGoals(userId: string): Promise<WeeklyGoal[]> {
  // At most one goal per measure, so the list is as long as there are measures; the order is the order they were made in.
  return prisma.weeklyGoal.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50 });
}

export function createGoal(userId: string, data: { measure: string; target: number }): Promise<WeeklyGoal> {
  return prisma.weeklyGoal.create({ data: { ...data, userId } });
}

/** Changes the caller's goal's target; false when there is none with that id. */
export async function setTarget(userId: string, id: string, target: number): Promise<boolean> {
  const { count } = await prisma.weeklyGoal.updateMany({ where: { id, userId }, data: { target } });
  return count === 1;
}

export async function deleteGoal(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.weeklyGoal.deleteMany({ where: { id, userId } });
  return count === 1;
}
