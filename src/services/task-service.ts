import "server-only";
import { randomUUID } from "node:crypto";
import { indexEntity, deleteEntityEmbeddings } from "@/lib/vector";
import { AppError } from "@/lib/api-response";
import * as taskRepository from "@/repositories/task-repository";
import { assertProjectOwned, recalculateProgress } from "@/services/project-service";
import { assertCourseOwned } from "@/services/course-service";
import { assertGoalOwned, recalculateGoalProgress } from "@/services/goal-service";
import { generateOccurrences, type RecurrenceFrequency } from "@/lib/recurrence";
import { embeddableTextFor } from "@/services/embeddable-text";
import type { TaskInput, TaskStatus, TaskPriority } from "@/repositories/task-repository";
import type { TaskModel as Task } from "@/generated/prisma/models";

export type TaskBucket = "overdue" | "today" | "upcoming" | "someday";

export type GroupedTasks = {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  someday: Task[];
  done: Task[];
};

async function syncTaskIndex(userId: string, task: Task): Promise<void> {
  try {
    await indexEntity(userId, "task", task.id, embeddableTextFor.task(task));
  } catch (error) {
    console.error(`[WARN] Failed to index task ${task.id}:`, error);
    await deleteEntityEmbeddings(userId, "task", task.id).catch(() => {});
  }
}

// Buckets are whole-day, not instant-based: a task due at 09:00 is still "today"
// at 18:00, not overdue. Only a due date before midnight this morning is overdue.
export function bucketOf(task: Task, now = new Date()): TaskBucket {
  if (!task.dueDate) return "someday";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  if (task.dueDate < startOfToday) return "overdue";
  return task.dueDate <= endOfToday ? "today" : "upcoming";
}

export async function groupTasks(
  userId: string,
  now = new Date(),
  options: { tag?: string } = {},
): Promise<GroupedTasks> {
  const tasks = await taskRepository.listTasks(userId, {
    includeDone: true,
    tag: options.tag,
  });

  const grouped: GroupedTasks = {
    overdue: [],
    today: [],
    upcoming: [],
    someday: [],
    done: [],
  };

  for (const task of tasks) {
    if (task.status === "done") {
      grouped.done.push(task);
    } else {
      grouped[bucketOf(task, now)].push(task);
    }
  }

  grouped.done.sort(
    (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
  );

  return grouped;
}

/**
 * A task may be scheduled with just a start; the block then runs for as long as
 * the task is estimated to take. An explicit end must be after the start.
 */
function resolveSchedule(input: TaskInput): TaskInput {
  if (!input.scheduledStart) {
    // An end without a start is meaningless, so it is dropped rather than stored.
    return { ...input, scheduledStart: null, scheduledEnd: null };
  }

  if (input.scheduledEnd && input.scheduledEnd <= input.scheduledStart) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The scheduled block must end after it starts.",
    );
  }

  return {
    ...input,
    scheduledEnd:
      input.scheduledEnd ??
      new Date(
        input.scheduledStart.getTime() + input.estimatedMinutes * 60_000,
      ),
  };
}

export async function createTask(
  userId: string,
  input: TaskInput,
): Promise<Task> {
  await assertProjectOwned(userId, input.projectId);
  await assertCourseOwned(userId, input.courseId);
  await assertGoalOwned(userId, input.goalId);
  const task = await taskRepository.createTask(userId, resolveSchedule(input));
  await syncTaskIndex(userId, task);
  await recalculateProgress(userId, task.projectId);
  // A task's direct goalId is independent of its project's — recalculateProgress
  // above already cascades to the *project's* goal, not this one.
  await recalculateGoalProgress(userId, task.goalId);
  return task;
}

export async function updateTask(
  userId: string,
  taskId: string,
  input: TaskInput,
): Promise<Task> {
  await assertProjectOwned(userId, input.projectId);
  await assertCourseOwned(userId, input.courseId);
  await assertGoalOwned(userId, input.goalId);

  const before = await taskRepository.getTask(userId, taskId);
  const task = await taskRepository.updateTask(userId, taskId, resolveSchedule(input));
  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
  }

  await syncTaskIndex(userId, task);
  // Moving a task between projects changes the progress of both.
  await recalculateProgress(userId, before?.projectId);
  if (before?.projectId !== task.projectId) {
    await recalculateProgress(userId, task.projectId);
  }
  // Same before/after handling for a direct goal link.
  await recalculateGoalProgress(userId, before?.goalId);
  if (before?.goalId !== task.goalId) {
    await recalculateGoalProgress(userId, task.goalId);
  }
  return task;
}

export async function setTaskStatus(
  userId: string,
  taskId: string,
  status: TaskStatus,
): Promise<Task> {
  const task = await taskRepository.setTaskStatus(userId, taskId, status);
  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
  }
  await syncTaskIndex(userId, task);
  await recalculateProgress(userId, task.projectId);
  await recalculateGoalProgress(userId, task.goalId);
  return task;
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  const before = await taskRepository.getTask(userId, taskId);
  const deleted = await taskRepository.softDeleteTask(userId, taskId);
  if (!deleted) {
    throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
  }
  await deleteEntityEmbeddings(userId, "task", taskId);
  await recalculateProgress(userId, before?.projectId);
  await recalculateGoalProgress(userId, before?.goalId);
}

/**
 * Undoes `deleteTask`. A restored task counts towards its project again, so
 * progress has to be recomputed as well as the index rebuilt.
 */
export async function restoreTask(userId: string, taskId: string): Promise<Task> {
  const task = await taskRepository.restoreTask(userId, taskId);
  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "That task is not in the trash.");
  }

  await syncTaskIndex(userId, task);
  await recalculateProgress(userId, task.projectId);
  await recalculateGoalProgress(userId, task.goalId);
  return task;
}

export async function purgeTask(userId: string, taskId: string): Promise<void> {
  const purged = await taskRepository.purgeTask(userId, taskId);
  if (!purged) {
    throw new AppError("RESOURCE_NOT_FOUND", "That task is not in the trash.");
  }
}

/**
 * Materializes `count` real Task rows spaced by `frequency`, anchored on
 * `input.dueDate` — the same one-time-materialization approach as
 * `createRecurringEvents` in event-service.ts, for the same reason: every
 * existing read path already works against real rows with no changes. A
 * scheduled time block, if set, shifts by the same delta as the due date so
 * it stays the same time-of-day relative to each occurrence.
 */
export async function createRecurringTasks(
  userId: string,
  input: TaskInput,
  frequency: RecurrenceFrequency,
  count: number,
): Promise<Task[]> {
  if (!input.dueDate) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A recurring task needs a due date to repeat from.",
    );
  }

  const recurrenceId = randomUUID();
  const baseDue = input.dueDate.getTime();
  const dueDates = generateOccurrences(input.dueDate, frequency, count);

  const tasks: Task[] = [];
  for (const dueDate of dueDates) {
    const delta = dueDate.getTime() - baseDue;
    tasks.push(
      await createTask(userId, {
        ...input,
        dueDate,
        scheduledStart: input.scheduledStart
          ? new Date(input.scheduledStart.getTime() + delta)
          : null,
        scheduledEnd: input.scheduledEnd
          ? new Date(input.scheduledEnd.getTime() + delta)
          : null,
        recurrenceId,
      }),
    );
  }
  return tasks;
}

/** Deletes this occurrence and every later one in its series, keeping past ones as history. */
export async function deleteTaskSeriesFrom(
  userId: string,
  taskId: string,
): Promise<number> {
  const task = await taskRepository.getTask(userId, taskId);
  if (!task || !task.recurrenceId || !task.dueDate) {
    throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
  }

  const ids = await taskRepository.listSeriesTaskIds(userId, task.recurrenceId, task.dueDate);
  for (const id of ids) await deleteTask(userId, id);
  return ids.length;
}

/**
 * Drops a task onto `scheduledStart`, leaving its end to `resolveSchedule`'s
 * usual estimatedMinutes default. `updateTask` replaces the whole record, so
 * every other field is read back from the existing row first rather than
 * only sending the two schedule fields and silently wiping the rest.
 */
export async function scheduleTask(
  userId: string,
  taskId: string,
  scheduledStart: Date,
): Promise<Task> {
  const existing = await taskRepository.getTask(userId, taskId);
  if (!existing) {
    throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
  }

  return updateTask(userId, taskId, {
    title: existing.title,
    description: existing.description,
    priority: existing.priority as TaskPriority,
    tags: existing.tags,
    courseId: existing.courseId,
    goalId: existing.goalId,
    dueDate: existing.dueDate,
    estimatedMinutes: existing.estimatedMinutes,
    projectId: existing.projectId,
    scheduledStart,
    scheduledEnd: null,
  });
}
