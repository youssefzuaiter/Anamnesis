import "server-only";
import { AppError } from "@/lib/api-response";
import {
  DAILY_TAG,
  buildDailyNote,
  dailyTitle,
  planCarryOver,
  tomorrowDue,
  type CarryOverPlan,
} from "@/lib/daily";
import { dayBounds } from "@/lib/day";
import { bucketOf } from "@/lib/task-bucket";
import * as eventRepository from "@/repositories/event-repository";
import * as noteRepository from "@/repositories/note-repository";
import * as taskRepository from "@/repositories/task-repository";
import * as noteService from "@/services/note-service";
import * as taskService from "@/services/task-service";

/** Today's daily note if there is one. Never creates anything. */
export async function findTodayNote(
  userId: string,
  now: Date = new Date(),
): Promise<{ id: string; updatedAt: Date } | null> {
  const note = await noteRepository.findDailyNote(userId, dailyTitle(now));
  return note ? { id: note.id, updatedAt: note.updatedAt } : null;
}

/**
 * Today's daily note, made first if there is none. Called only when the person
 * asks, never when a page loads. It is an ordinary note, so it goes through
 * `createNote` like any other and is indexed, linked and exported with the rest.
 * Its text is a snapshot of the day as it is now.
 *
 * Two requests at the same instant could each find nothing and each create one:
 * there is no database constraint behind this (a deliberate choice, see
 * CLAUDE.md), so opening picks the earliest if that ever happens.
 */
export async function openTodayNote(
  userId: string,
  now: Date = new Date(),
): Promise<{ id: string; created: boolean }> {
  const existing = await findTodayNote(userId, now);
  if (existing) return { id: existing.id, created: false };

  const { from, to } = dayBounds(now);
  const [events, scheduled, open] = await Promise.all([
    eventRepository.listEventsInRange(userId, from, to),
    taskRepository.listScheduledInRange(userId, from, to),
    taskRepository.listTasks(userId),
  ]);

  const content = buildDailyNote({
    day: now,
    events: events.map((event) => ({
      title: event.title,
      start: event.startTime,
      end: event.endTime,
      location: event.location,
    })),
    blocks: scheduled.flatMap((task) =>
      task.scheduledStart && task.scheduledEnd && task.status !== "done"
        ? [{ title: task.title, start: task.scheduledStart, end: task.scheduledEnd }]
        : [],
    ),
    tasks: open
      .filter((task) => bucketOf(task, now) === "today")
      .map((task) => ({ title: task.title, priority: task.priority })),
  });

  const note = await noteService.createNote(userId, {
    title: dailyTitle(now),
    content,
    tags: [DAILY_TAG],
    isFavorite: false,
    projectId: null,
    courseId: null,
  });
  return { id: note.id, created: true };
}

/**
 * What Shut down day would move. Writes nothing: the person confirms first, the
 * same shape Plan my day uses. Only this account's own tasks are ever listed.
 */
export async function proposeShutdown(
  userId: string,
  now: Date = new Date(),
): Promise<CarryOverPlan & { tomorrow: Date }> {
  const tasks = await taskRepository.listTasks(userId);
  return { ...planCarryOver(tasks, now), tomorrow: dayBounds(now).to };
}

/**
 * Moves the requested tasks to tomorrow. Re-derives the list rather than
 * trusting the ids sent back: they went through the browser, so they are client
 * input. An id that is not in this account's own list (another account's task,
 * a done task, one already moved) is simply not in it and is ignored; if none
 * are left, nothing moves and the person is told to review again.
 */
export async function applyShutdown(
  userId: string,
  now: Date,
  taskIds: string[],
): Promise<{ moved: number; tomorrow: Date }> {
  const plan = await proposeShutdown(userId, now);
  const wanted = new Set(taskIds);
  const items = [...plan.dueToday, ...plan.overdue].filter((item) =>
    wanted.has(item.id),
  );

  if (items.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Those tasks have already moved or are done. Review the list again.",
    );
  }

  for (const item of items) {
    await taskService.carryTaskTo(
      userId,
      item.id,
      tomorrowDue(item.dueDate, now),
      item.plannedStart !== null,
    );
  }
  return { moved: items.length, tomorrow: plan.tomorrow };
}
