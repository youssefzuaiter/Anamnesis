/**
 * Fits unscheduled work into the gaps left by a day's commitments.
 *
 * Deliberately pure arithmetic rather than a model call — the same split the
 * capture parser makes. A 3B model is unreliable at calendar arithmetic, and
 * there is nothing here it would be better at: which task matters most is a
 * sort, and where it fits is subtraction.
 */

export type Busy = { start: Date; end: Date };

/**
 * The commitments of a stretch of days: real appointments and blocks already
 * set aside both count. A planned block with no end is skipped.
 */
export function busyFrom(
  events: { startTime: Date; endTime: Date }[],
  scheduled: { scheduledStart: Date | null; scheduledEnd: Date | null }[],
): Busy[] {
  return [
    ...events.map((event) => ({ start: event.startTime, end: event.endTime })),
    ...scheduled.flatMap((task) =>
      task.scheduledStart && task.scheduledEnd
        ? [{ start: task.scheduledStart, end: task.scheduledEnd }]
        : [],
    ),
  ];
}

export type Plannable = {
  id: string;
  title: string;
  estimatedMinutes: number;
  priority: string;
  dueDate: Date | null;
};

export type PlannedBlock = {
  taskId: string;
  title: string;
  start: Date;
  end: Date;
};

export const DAY_START_HOUR = 9;
export const DAY_END_HOUR = 21;

/** Below this a gap is not worth switching context into. */
const MIN_USABLE_MINUTES = 15;

/** A breather between blocks, so a plan is not a wall of back-to-back work. */
export const GAP_MINUTES = 10;

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function atHour(day: Date, hour: number): Date {
  const date = new Date(day);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/** The free intervals of `day`, given what is already committed. */
export function freeIntervals(day: Date, busy: Busy[], now: Date): Busy[] {
  const dayStart = atHour(day, DAY_START_HOUR);
  const dayEnd = atHour(day, DAY_END_HOUR);

  // Never plan into time that has already passed. Clamping only the lower
  // bound matters: an `&& now < dayEnd` here would fall back to dayStart once
  // the day was over, and happily propose this morning's 09:00 at 23:00.
  const from = now > dayStart ? new Date(now) : dayStart;
  if (from >= dayEnd) return [];

  const sorted = [...busy]
    .filter((slot) => slot.end > from && slot.start < dayEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const free: Busy[] = [];
  let cursor = from;

  for (const slot of sorted) {
    if (slot.start > cursor) {
      free.push({ start: new Date(cursor), end: new Date(slot.start) });
    }
    if (slot.end > cursor) cursor = new Date(slot.end);
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });

  return free.filter(
    (slot) =>
      (slot.end.getTime() - slot.start.getTime()) / 60_000 >= MIN_USABLE_MINUTES,
  );
}

/**
 * Highest priority first, then soonest due, then shortest — so a day that
 * cannot fit everything still fills with the work that matters most, and ties
 * break towards finishing something.
 */
function byUrgency(a: Plannable, b: Plannable): number {
  const priority =
    (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  if (priority !== 0) return priority;

  const due =
    (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER);
  if (due !== 0) return due;

  return a.estimatedMinutes - b.estimatedMinutes;
}

/**
 * Places as many tasks as fit. A task is never split across gaps and never
 * shortened: a 90-minute task does not become a 30-minute block because that
 * is all that was left, it simply waits for a day with room.
 */
export function planDay(
  day: Date,
  busy: Busy[],
  tasks: Plannable[],
  now: Date = new Date(),
): PlannedBlock[] {
  const gaps = freeIntervals(day, busy, now).map((gap) => ({
    cursor: new Date(gap.start),
    end: gap.end,
  }));

  const blocks: PlannedBlock[] = [];

  for (const task of [...tasks].sort(byUrgency)) {
    const needed = Math.max(MIN_USABLE_MINUTES, task.estimatedMinutes);

    for (const gap of gaps) {
      const remaining = (gap.end.getTime() - gap.cursor.getTime()) / 60_000;
      if (remaining < needed) continue;

      const start = new Date(gap.cursor);
      const end = new Date(start.getTime() + needed * 60_000);
      blocks.push({ taskId: task.id, title: task.title, start, end });

      gap.cursor = new Date(end.getTime() + GAP_MINUTES * 60_000);
      break;
    }
  }

  return blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
}
