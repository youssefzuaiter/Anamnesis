/**
 * Counting for the weekly review (ROADMAP item 31). Pure: the service passes in the finished tasks it read, and
 * gets back how many each goal and course received. A task counts once for a goal even when it is linked to that
 * goal both directly and through its project, the same rule the goal's own progress uses.
 */

export type GoalLink = { id: string; goalId: string | null; projectGoalId: string | null };

export function tasksPerGoal(tasks: GoalLink[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const goals = new Set([task.goalId, task.projectGoalId].filter((id): id is string => Boolean(id)));
    for (const goal of goals) counts.set(goal, (counts.get(goal) ?? 0) + 1);
  }
  return counts;
}

export function tasksPerCourse(tasks: { courseId: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.courseId) counts.set(task.courseId, (counts.get(task.courseId) ?? 0) + 1);
  }
  return counts;
}
