import "server-only";
import { AppError } from "@/lib/api-response";
import { busyFrom } from "@/lib/day-planner";
import { MAX_WEEK_TASKS, bookedMinutes, isoDay, parseWeekParam, planWeek, weekDays } from "@/lib/week-planner";
import * as eventRepository from "@/repositories/event-repository";
import * as taskRepository from "@/repositories/task-repository";
import { scheduleTask } from "@/services/task-service";

/*
 * Plan my week (ROADMAP 51): the day planner's rule over the seven days of a week. `proposeWeek` writes nothing; `applyWeek` works the plan out
 * again and schedules only the blocks whose task AND start still match what the person was shown (the browser's times are only compared, never used).
 */

export type WeekBlockView = { taskId: string; title: string; start: string; end: string; priority: string; dueDate: string | null; minutes: number };
export type WeekBookedView = { title: string; start: string; end: string; kind: "event" | "planned" };
export type WeekUnplacedView = { taskId: string; title: string; minutes: number; dueDate: string | null; reason: "before-due" | "no-room" };
export type WeekDayView = { date: string; bookedMinutes: number; plannedMinutes: number };
export type WeekProposal = { weekStart: string; days: WeekDayView[]; blocks: WeekBlockView[]; booked: WeekBookedView[]; unplaced: WeekUnplacedView[] };

function mondayOf(weekStart: string): Date {
  const parsed = parseWeekParam(weekStart);
  if (!parsed) throw new AppError("VALIDATION_ERROR", "That is not a week.");
  return parsed;
}

export async function proposeWeek(userId: string, weekStart: string, now: Date = new Date()): Promise<WeekProposal> {
  const days = weekDays(mondayOf(weekStart));
  const from = days[0];
  const to = new Date(days[6].getFullYear(), days[6].getMonth(), days[6].getDate() + 1);

  const [events, scheduled, unscheduled] = await Promise.all([
    eventRepository.listEventsInRange(userId, from, to),
    taskRepository.listScheduledInRange(userId, from, to),
    taskRepository.listUnscheduled(userId, MAX_WEEK_TASKS),
  ]);
  const busy = busyFrom(events, scheduled);
  const plan = planWeek(
    days,
    busy,
    unscheduled.map((t) => ({ id: t.id, title: t.title, estimatedMinutes: t.estimatedMinutes, priority: t.priority, dueDate: t.dueDate })),
    now,
  );

  return {
    weekStart: isoDay(from),
    days: days.map((day) => ({
      date: isoDay(day),
      bookedMinutes: Math.round(bookedMinutes(day, busy)),
      plannedMinutes: plan.blocks.filter((b) => isoDay(b.start) === isoDay(day)).reduce((sum, b) => sum + b.minutes, 0),
    })),
    blocks: plan.blocks.map((b) => ({ taskId: b.taskId, title: b.title, start: b.start.toISOString(), end: b.end.toISOString(), priority: b.priority, dueDate: b.dueDate?.toISOString() ?? null, minutes: b.minutes })),
    booked: [
      ...events.map((e) => ({ title: e.title, start: e.startTime.toISOString(), end: e.endTime.toISOString(), kind: "event" as const })),
      ...scheduled.flatMap((t) => (t.scheduledStart && t.scheduledEnd ? [{ title: t.title, start: t.scheduledStart.toISOString(), end: t.scheduledEnd.toISOString(), kind: "planned" as const }] : [])),
    ],
    unplaced: plan.unplaced.map((u) => ({ taskId: u.taskId, title: u.title, minutes: u.minutes, dueDate: u.dueDate?.toISOString() ?? null, reason: u.reason })),
  };
}

/**
 * Schedules the confirmed blocks. The plan is worked out again, and a block is applied only if the same task is still proposed at the same start;
 * anything the calendar has changed under the person drops out and is counted, so the page can say "3 of the 5 you ticked".
 */
export async function applyWeek(
  userId: string,
  weekStart: string,
  picks: { taskId: string; start: string }[],
  now: Date = new Date(),
): Promise<{ scheduled: number; requested: number }> {
  const proposal = await proposeWeek(userId, weekStart, now);
  const wanted = new Map(picks.map((p) => [p.taskId, new Date(p.start).getTime()]));
  const applying = proposal.blocks.filter((b) => wanted.get(b.taskId) === new Date(b.start).getTime());
  if (applying.length === 0) throw new AppError("VALIDATION_ERROR", "Those tasks no longer fit the week. Propose a plan again.");
  for (const block of applying) await scheduleTask(userId, block.taskId, new Date(block.start));
  return { scheduled: applying.length, requested: wanted.size };
}

