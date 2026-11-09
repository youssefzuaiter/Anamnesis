import "server-only";
import { randomUUID } from "node:crypto";
import { indexEntity, deleteEntityEmbeddings } from "@/lib/vector";
import { AppError } from "@/lib/api-response";
import * as eventRepository from "@/repositories/event-repository";
import * as taskRepository from "@/repositories/task-repository";
import { assertProjectOwned } from "@/services/project-service";
import { generateOccurrences, type RecurrenceFrequency } from "@/lib/recurrence";
import { embeddableTextFor } from "@/services/embeddable-text";
import { checkRange } from "@/lib/time-grid";
import { applyEventChange, diffEvent, isEmptyChange, sameEvent, type EventFields } from "@/lib/series-edit";
import type { EventInput } from "@/repositories/event-repository";
import type { EventModel as Event } from "@/generated/prisma/models";

export type ScheduledTask = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  done: boolean;
  recurring: boolean;
};

export type CalendarDay = {
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: Event[];
  tasks: ScheduledTask[];
};

async function syncEventIndex(userId: string, event: Event): Promise<void> {
  try {
    await indexEntity(userId, "event", event.id, embeddableTextFor.event(event));
  } catch (error) {
    console.error(`[WARN] Failed to index event ${event.id}:`, error);
    await deleteEntityEmbeddings(userId, "event", event.id).catch(() => {});
  }
}

/** Lets the calendar-feed importer index the rows it writes with exactly the
 *  same phrasing as an event created by hand, without duplicating
 *  `embeddableText` or exposing it. */
export const indexEvent = syncEventIndex;

function assertValidRange(input: EventInput): void {
  if (input.endTime <= input.startTime) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The event must end after it starts.",
    );
  }
}

export async function createEvent(
  userId: string,
  input: EventInput,
): Promise<Event> {
  assertValidRange(input);
  await assertProjectOwned(userId, input.projectId);
  const event = await eventRepository.createEvent(userId, input);
  await syncEventIndex(userId, event);
  return event;
}

export async function updateEvent(
  userId: string,
  eventId: string,
  input: EventInput,
): Promise<Event> {
  assertValidRange(input);
  await assertProjectOwned(userId, input.projectId);
  const event = await eventRepository.updateEvent(userId, eventId, input);
  if (!event) {
    throw new AppError("RESOURCE_NOT_FOUND", "That event no longer exists.");
  }
  await syncEventIndex(userId, event);
  return event;
}

const eventFields = (event: EventFields): EventFields => ({
  title: event.title,
  description: event.description,
  location: event.location,
  projectId: event.projectId,
  startTime: event.startTime,
  endTime: event.endTime,
});

/**
 * Saves this occurrence and carries what the person changed to every later occurrence of its series. The later rows
 * are worked out from this one's **old** start (so moving it past them does not lose any), this row is written first
 * (its range and project are checked before anything is), and then each later row whose result differs is written
 * through `updateEvent`, which re-indexes it. A row that is not part of a series, or has no later ones, or a change
 * that is only a move to another day, saves just this row. Not atomic: a failure part-way leaves the earlier rows
 * changed. `changed` counts the rows actually written, this one included.
 */
export async function updateEventSeriesFrom(
  userId: string,
  eventId: string,
  input: EventInput,
): Promise<{ changed: number }> {
  const before = await eventRepository.getEvent(userId, eventId);
  if (!before) throw new AppError("RESOURCE_NOT_FOUND", "That event no longer exists.");

  const later = before.recurrenceId
    ? await eventRepository.listLaterSeriesEvents(userId, before.recurrenceId, before.startTime, before.id)
    : [];
  const change = diffEvent(eventFields(before), eventFields(input));

  await updateEvent(userId, eventId, input);
  let changed = 1;
  if (isEmptyChange(change)) return { changed };

  for (const row of later) {
    const current = eventFields(row);
    const next = applyEventChange(current, change);
    if (sameEvent(next, current)) continue;
    await updateEvent(userId, row.id, next);
    changed += 1;
  }
  return { changed };
}

/**
 * Moves or resizes an event: only its two times change. The range is checked first (it came from the browser), then
 * whose the event is; an imported event is refused with the place to change it, since its feed would undo the move.
 */
export async function rescheduleEvent(
  userId: string,
  eventId: string,
  startTime: Date,
  endTime: Date,
): Promise<Event> {
  const problem = checkRange(startTime.getTime(), endTime.getTime());
  if (problem) throw new AppError("VALIDATION_ERROR", problem);

  const existing = await eventRepository.getEvent(userId, eventId);
  if (!existing) throw new AppError("RESOURCE_NOT_FOUND", "That event no longer exists.");
  if (existing.subscriptionId) {
    throw new AppError("VALIDATION_ERROR", "An imported event can't be moved here. Change it in the calendar it came from.");
  }

  const event = await eventRepository.setEventTimes(userId, eventId, startTime, endTime);
  if (!event) throw new AppError("RESOURCE_NOT_FOUND", "That event no longer exists.");
  await syncEventIndex(userId, event);
  return event;
}

export async function deleteEvent(
  userId: string,
  eventId: string,
): Promise<void> {
  const deleted = await eventRepository.deleteEvent(userId, eventId);
  if (!deleted) {
    throw new AppError("RESOURCE_NOT_FOUND", "That event no longer exists.");
  }
  await deleteEntityEmbeddings(userId, "event", eventId);
}

/**
 * Materializes `count` real Event rows spaced by `frequency`, starting at
 * `input.startTime` — not a stored rule that gets expanded later, so every
 * existing read path (calendar grids, dashboard, search, the assistant)
 * already works against these rows with no changes. Each occurrence keeps
 * the same duration as the first.
 */
export async function createRecurringEvents(
  userId: string,
  input: EventInput,
  frequency: RecurrenceFrequency,
  count: number,
): Promise<Event[]> {
  const recurrenceId = randomUUID();
  const duration = input.endTime.getTime() - input.startTime.getTime();
  const starts = generateOccurrences(input.startTime, frequency, count);

  const events: Event[] = [];
  for (const start of starts) {
    const end = new Date(start.getTime() + duration);
    events.push(
      await createEvent(userId, { ...input, startTime: start, endTime: end, recurrenceId }),
    );
  }
  return events;
}

/** Deletes this occurrence and every later one in its series, keeping past ones as history. */
export async function deleteEventSeriesFrom(
  userId: string,
  eventId: string,
): Promise<number> {
  const event = await eventRepository.getEvent(userId, eventId);
  if (!event || !event.recurrenceId) {
    throw new AppError("RESOURCE_NOT_FOUND", "That event no longer exists.");
  }

  const ids = await eventRepository.listSeriesEventIds(userId, event.recurrenceId, event.startTime);
  for (const id of ids) await deleteEvent(userId, id);
  return ids.length;
}

export function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1, 0, 0, 0, 0);
}

/** The Monday of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date);
  const weekdayFromMonday = (date.getDay() + 6) % 7;
  start.setDate(date.getDate() - weekdayFromMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

async function fetchRangeData(
  userId: string,
  rangeStart: Date,
  days: number,
): Promise<{ events: Event[]; blocks: ScheduledTask[] }> {
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeStart.getDate() + days);

  const [events, scheduled] = await Promise.all([
    eventRepository.listEventsInRange(userId, rangeStart, rangeEnd),
    taskRepository.listScheduledInRange(userId, rangeStart, rangeEnd),
  ]);

  // Scheduled tasks share the calendar with events but stay distinguishable:
  // a time block is a plan to work, not an appointment.
  const blocks: ScheduledTask[] = scheduled.flatMap((task) =>
    task.scheduledStart && task.scheduledEnd
      ? [{
          id: task.id,
          title: task.title,
          start: task.scheduledStart,
          end: task.scheduledEnd,
          done: task.status === "done",
          recurring: Boolean(task.recurrenceId),
        }]
      : [],
  );

  return { events, blocks };
}

function buildDays(
  rangeStart: Date,
  days: number,
  now: Date,
  events: Event[],
  blocks: ScheduledTask[],
  inCurrentMonth?: (date: Date) => boolean,
): CalendarDay[] {
  const todayKey = dayKey(now);

  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(rangeStart);
    date.setDate(rangeStart.getDate() + offset);

    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return {
      date,
      inCurrentMonth: inCurrentMonth ? inCurrentMonth(date) : true,
      isToday: dayKey(date) === todayKey,
      events: events.filter(
        (event) => event.startTime <= dayEnd && event.endTime >= dayStart,
      ),
      tasks: blocks.filter(
        (block) => block.start <= dayEnd && block.end >= dayStart,
      ),
    };
  });
}

/**
 * Six weeks of days covering the given month, always starting on a Monday, so
 * the grid height never changes between months.
 */
export async function buildMonthGrid(
  userId: string,
  year: number,
  month: number,
  now = new Date(),
): Promise<CalendarDay[]> {
  const gridStart = startOfWeek(startOfMonth(year, month));
  const { events, blocks } = await fetchRangeData(userId, gridStart, 42);
  return buildDays(
    gridStart,
    42,
    now,
    events,
    blocks,
    (date) => date.getMonth() === month && date.getFullYear() === year,
  );
}

/** The Monday-to-Sunday week containing `referenceDate`. */
export async function buildWeekGrid(
  userId: string,
  referenceDate: Date,
  now = new Date(),
): Promise<CalendarDay[]> {
  const weekStart = startOfWeek(referenceDate);
  const { events, blocks } = await fetchRangeData(userId, weekStart, 7);
  return buildDays(weekStart, 7, now, events, blocks);
}

/** A single day, returned as a one-element grid so callers share the same shape. */
export async function buildDayGrid(
  userId: string,
  day: Date,
  now = new Date(),
): Promise<CalendarDay[]> {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const { events, blocks } = await fetchRangeData(userId, dayStart, 1);
  return buildDays(dayStart, 1, now, events, blocks);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
