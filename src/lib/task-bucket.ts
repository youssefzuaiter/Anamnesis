export type TaskBucket = "overdue" | "today" | "upcoming" | "someday";

// Buckets are whole-day, not instant-based: a task due at 09:00 is still "today"
// at 18:00, not overdue. Only a due date before midnight this morning is overdue.
//
// Lives here, not in task-service, so pure code (the daily note and Shut down
// day) can use the same rule without importing the database layer.
export function bucketOf(
  task: { dueDate: Date | null },
  now = new Date(),
): TaskBucket {
  if (!task.dueDate) return "someday";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  if (task.dueDate < startOfToday) return "overdue";
  return task.dueDate <= endOfToday ? "today" : "upcoming";
}
