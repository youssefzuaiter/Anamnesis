// What "edit this and later occurrences" copies, and how. A series is real rows that share a `recurrenceId` (see
// `lib/recurrence.ts`), so an edit to one occurrence is applied to a later one by working out what the person
// *changed* and putting only that on the later row: a later occurrence someone edited on its own keeps its own value
// for everything that was not changed. Dates are never copied. Pure: no Prisma, no React, so the rules can be tested
// without a database. Every step is taken on the local wall clock (a day is a calendar day, not 24 hours).

export type SeriesScope = "this" | "future";

/** What a save of an occurrence did: how many rows it changed (this one included) and for which scope. */
export type SeriesSaved = { changed: number; scope: SeriesScope };

// ---- Events: title, description, location, project, time of day and length ----

export type EventFields = {
  title: string;
  description: string | null;
  location: string | null;
  projectId: string | null;
  startTime: Date;
  endTime: Date;
};

export type EventChange = Partial<Pick<EventFields, "title" | "description" | "location" | "projectId">> & {
  /** The new start's minutes after local midnight, when the time of day changed. */
  startMinutes?: number;
  /** The new length in milliseconds, when the length changed. */
  durationMs?: number;
};

const minutesOfDay = (date: Date): number => date.getHours() * 60 + date.getMinutes();
const lengthOf = (event: EventFields): number => event.endTime.getTime() - event.startTime.getTime();

/** The fields of an event that differ. A move to another day alone is not a change: each occurrence keeps its day. */
export function diffEvent(before: EventFields, after: EventFields): EventChange {
  const change: EventChange = {};
  if (before.title !== after.title) change.title = after.title;
  if (before.description !== after.description) change.description = after.description;
  if (before.location !== after.location) change.location = after.location;
  if (before.projectId !== after.projectId) change.projectId = after.projectId;
  if (minutesOfDay(before.startTime) !== minutesOfDay(after.startTime)) change.startMinutes = minutesOfDay(after.startTime);
  if (lengthOf(before) !== lengthOf(after)) change.durationMs = lengthOf(after);
  return change;
}

/**
 * The event with the change put on it, as a new object. The row keeps its own date; a new time of day is set on that
 * date, and the end is the start plus the new length, or the row's own length if the length did not change.
 */
export function applyEventChange(row: EventFields, change: EventChange): EventFields {
  const next = { ...row };
  if (change.title !== undefined) next.title = change.title;
  if (change.description !== undefined) next.description = change.description;
  if (change.location !== undefined) next.location = change.location;
  if (change.projectId !== undefined) next.projectId = change.projectId;

  const start =
    change.startMinutes === undefined
      ? row.startTime
      : new Date(row.startTime.getFullYear(), row.startTime.getMonth(), row.startTime.getDate(), 0, change.startMinutes, 0, 0);
  next.startTime = start;
  next.endTime = new Date(start.getTime() + (change.durationMs ?? lengthOf(row)));
  return next;
}

export function sameEvent(a: EventFields, b: EventFields): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.location === b.location &&
    a.projectId === b.projectId &&
    a.startTime.getTime() === b.startTime.getTime() &&
    a.endTime.getTime() === b.endTime.getTime()
  );
}

// ---- Tasks: title, description, priority, tags, estimate, project, course and goal ----

export type TaskFields = {
  title: string;
  description: string | null;
  priority: string;
  tags: string[];
  estimatedMinutes: number;
  projectId: string | null;
  courseId: string | null;
  goalId: string | null;
};

export type TaskChange = Partial<TaskFields>;

const sameTags = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((tag, i) => tag === b[i]);

/** The fields of a task that differ. Never the due date, the time block, the status or the checklist. */
export function diffTask(before: TaskFields, after: TaskFields): TaskChange {
  const change: TaskChange = {};
  if (before.title !== after.title) change.title = after.title;
  if (before.description !== after.description) change.description = after.description;
  if (before.priority !== after.priority) change.priority = after.priority;
  if (!sameTags(before.tags, after.tags)) change.tags = after.tags;
  if (before.estimatedMinutes !== after.estimatedMinutes) change.estimatedMinutes = after.estimatedMinutes;
  if (before.projectId !== after.projectId) change.projectId = after.projectId;
  if (before.courseId !== after.courseId) change.courseId = after.courseId;
  if (before.goalId !== after.goalId) change.goalId = after.goalId;
  return change;
}

/** The task with the change put on it, as a new object; only the keys the change has are touched. */
export function applyTaskChange(row: TaskFields, change: TaskChange): TaskFields {
  return { ...row, ...change };
}

export function sameTask(a: TaskFields, b: TaskFields): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.priority === b.priority &&
    sameTags(a.tags, b.tags) &&
    a.estimatedMinutes === b.estimatedMinutes &&
    a.projectId === b.projectId &&
    a.courseId === b.courseId &&
    a.goalId === b.goalId
  );
}

export function isEmptyChange(change: object): boolean {
  return Object.keys(change).length === 0;
}

/** What the form says after a save, from the server's count, so a date-only edit is not a silent no-op. */
export function savedMessage(saved: SeriesSaved | null): string {
  if (!saved || saved.scope === "this") return "Saved.";
  if (saved.changed <= 1) return "Saved. No later occurrence needed changing (dates are not copied).";
  const later = saved.changed - 1;
  return `Saved. The same change was made to ${later} later occurrence${later === 1 ? "" : "s"}.`;
}
