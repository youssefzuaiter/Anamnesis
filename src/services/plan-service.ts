import "server-only";
import { AppError } from "@/lib/api-response";
import { dayBounds } from "@/lib/day";
import { busyFrom, planDay, type PlannedBlock } from "@/lib/day-planner";
import * as eventRepository from "@/repositories/event-repository";
import * as taskRepository from "@/repositories/task-repository";
import { scheduleTask } from "@/services/task-service";

/**
 * What a plan for `day` would look like. Writes nothing — the user confirms
 * before any task is moved, the same shape the capture and tool-call paths use.
 */
export async function proposePlan(
  userId: string,
  day: Date,
  now: Date = new Date(),
): Promise<PlannedBlock[]> {
  const { from, to } = dayBounds(day);

  const [events, scheduled, unscheduled] = await Promise.all([
    eventRepository.listEventsInRange(userId, from, to),
    taskRepository.listScheduledInRange(userId, from, to),
    taskRepository.listUnscheduled(userId, 20),
  ]);

  const busy = busyFrom(events, scheduled);

  return planDay(
    day,
    busy,
    unscheduled.map((task) => ({
      id: task.id,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      priority: task.priority,
      dueDate: task.dueDate,
    })),
    now,
  );
}

/**
 * Applies a plan by scheduling each task at its proposed start. Re-derives the
 * plan rather than trusting the times sent back: the proposal went through the
 * browser, so it is client input regardless of what produced it.
 */
export async function applyPlan(
  userId: string,
  day: Date,
  taskIds: string[],
): Promise<{ scheduled: number }> {
  const plan = await proposePlan(userId, day);
  const wanted = new Set(taskIds);
  const applying = plan.filter((block) => wanted.has(block.taskId));

  if (applying.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Those tasks no longer fit the day. Propose a plan again.",
    );
  }

  for (const block of applying) {
    await scheduleTask(userId, block.taskId, block.start);
  }
  return { scheduled: applying.length };
}
