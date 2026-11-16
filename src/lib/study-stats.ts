// The study stats page (ROADMAP item 39): a streak and eight weeks of what the app already records. Pure: no Prisma and no
// React, so every rule is tested without a database. Days are the server's local calendar days, as everywhere else in the app.

export const STATS_WEEKS = 8;
/** Recorded study time counts for a day from this many seconds in all; a stray few seconds is not a day of study. */
export const MIN_STUDY_SECONDS = 60;

/** The day the card review log began. Before it only each card's last review is known (the migration wrote one line for it). */
export const CARD_LOG_BEGAN = "15 Nov 2026";

export type Activity = {
  /** When tasks were finished. */
  tasks: readonly Date[];
  /** When cards were reviewed. */
  cards: readonly Date[];
  /** Recorded study sessions. */
  study: readonly { at: Date; seconds: number }[];
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar date as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `days` calendar days from `date`, by calendar day (not 24 hours), so a clock change does not move it. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Midnight at the start of the Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const behind = (date.getDay() + 6) % 7; // Monday is 0
  return addDays(startOfDay(date), -behind);
}

/** The days on which something counts: a task finished, a card reviewed, or at least a minute of study recorded. */
export function activeDays(activity: Activity): Set<string> {
  const days = new Set<string>();
  for (const at of activity.tasks) days.add(dayKey(at));
  for (const at of activity.cards) days.add(dayKey(at));
  const seconds = new Map<string, number>();
  for (const session of activity.study) {
    const key = dayKey(session.at);
    seconds.set(key, (seconds.get(key) ?? 0) + session.seconds);
  }
  for (const [key, total] of seconds) if (total >= MIN_STUDY_SECONDS) days.add(key);
  return days;
}

export type Streaks = { current: number; longest: number; todayActive: boolean };

/**
 * The current streak ends today when today counts, else yesterday: a streak is not broken by a day that has not finished.
 * The longest is the longest run of consecutive calendar days anywhere in `active`.
 */
export function streaks(active: ReadonlySet<string>, now: Date): Streaks {
  const today = startOfDay(now);
  const todayActive = active.has(dayKey(today));
  let cursor = todayActive ? today : addDays(today, -1);
  let current = 0;
  while (active.has(dayKey(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  for (const key of active) {
    const [y, m, d] = key.split("-").map(Number);
    const day = new Date(y, m - 1, d);
    // Only the first day of a run starts a count, so the whole pass is linear.
    if (active.has(dayKey(addDays(day, -1)))) continue;
    let length = 0;
    for (let at = day; active.has(dayKey(at)); at = addDays(at, 1)) length += 1;
    if (length > longest) longest = length;
  }
  return { current, longest, todayActive };
}

/** Whole days since 1970 for the local calendar date, so two dates compare by calendar day whatever the clock did between them. */
function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

const LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The last `count` days ending today, oldest first, each with whether it counts. */
export function lastDays(active: ReadonlySet<string>, now: Date, count: number): { key: string; label: string; active: boolean }[] {
  const today = startOfDay(now);
  return Array.from({ length: count }, (_, index) => {
    const day = addDays(today, index - (count - 1));
    const key = dayKey(day);
    return { key, label: LABELS[day.getDay()], active: active.has(key) };
  });
}

export type WeekTotals = { start: Date; tasks: number; cards: number; studySeconds: number };

/**
 * Eight weeks, oldest first, the last one the week now falls in (so far). Anything before the first week or after today is not
 * counted, so a task dated in the future (clock skew, a typed date) never makes a bar.
 */
export function weeklyTotals(activity: Activity, now: Date, weeks: number = STATS_WEEKS): WeekTotals[] {
  const firstStart = addDays(startOfWeek(now), -7 * (weeks - 1));
  const endOfToday = addDays(startOfDay(now), 1);
  const out: WeekTotals[] = Array.from({ length: weeks }, (_, index) => ({
    start: addDays(firstStart, 7 * index),
    tasks: 0,
    cards: 0,
    studySeconds: 0,
  }));
  const firstNumber = dayNumber(firstStart);
  const place = (at: Date): WeekTotals | null => {
    if (at < firstStart || at >= endOfToday) return null;
    // By calendar day, not by milliseconds: a week that holds a clock change is 167 or 169 hours long.
    return out[Math.min(Math.floor((dayNumber(at) - firstNumber) / 7), weeks - 1)];
  };
  for (const at of activity.tasks) {
    const week = place(at);
    if (week) week.tasks += 1;
  }
  for (const at of activity.cards) {
    const week = place(at);
    if (week) week.cards += 1;
  }
  for (const session of activity.study) {
    const week = place(session.at);
    if (week) week.studySeconds += session.seconds;
  }
  return out;
}

/** "1 task", "0 tasks", "5 tasks". */
export function counted(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
