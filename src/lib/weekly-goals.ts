// Weekly goals (ROADMAP item 44): a small target such as "3 study sessions" every week, checked against what the app already records. Pure:
// no Prisma and no React. Weeks are Monday to Sunday by local calendar day, the rule the stats page uses, so a clock change never moves a day.
import { z } from "zod";
import { addDays, dayNumber, startOfDay, startOfWeek } from "@/lib/study-stats";

export const GOAL_MEASURES = ["study_sessions", "study_minutes", "cards_reviewed", "tasks_finished", "notes_written"] as const;
export type GoalMeasure = (typeof GOAL_MEASURES)[number];
export const MAX_TARGET = 999;
/** Finished weeks shown beside this one. */
export const GOAL_HISTORY_WEEKS = 8;

export const targetSchema = z.number().int().min(1, "A target is at least 1.").max(MAX_TARGET, `A target is at most ${MAX_TARGET}.`);
export const goalSchema = z.object({ measure: z.enum(GOAL_MEASURES), target: targetSchema });
export type GoalInput = z.infer<typeof goalSchema>;

const WORDS: Record<GoalMeasure, [one: string, many: string]> = {
  study_sessions: ["study session", "study sessions"],
  study_minutes: ["minute studied", "minutes studied"],
  cards_reviewed: ["card reviewed", "cards reviewed"],
  tasks_finished: ["task finished", "tasks finished"],
  notes_written: ["note written", "notes written"],
};

/** What the form calls each measure, and the target it starts from (a small one: a goal should be reachable). */
export const MEASURE_NAME: Record<GoalMeasure, string> = {
  study_sessions: "Study sessions",
  study_minutes: "Minutes studied",
  cards_reviewed: "Cards reviewed",
  tasks_finished: "Tasks finished",
  notes_written: "Notes written",
};
export const DEFAULT_TARGET: Record<GoalMeasure, number> = { study_sessions: 3, study_minutes: 120, cards_reviewed: 50, tasks_finished: 5, notes_written: 2 };

/** Whether a measure comes from the timer recorder, which records nothing while "Remember timer sessions" is off. */
export const needsRecorder = (measure: GoalMeasure): boolean => measure === "study_sessions" || measure === "study_minutes";

/** "3 study sessions", "1 card reviewed". */
export function goalLabel(measure: GoalMeasure, target: number): string {
  const [one, many] = WORDS[measure];
  return `${target} ${target === 1 ? one : many}`;
}

export type GoalActivity = {
  /** Recorded timer sessions. */
  sessions: readonly { at: Date; seconds: number }[];
  cards: readonly Date[];
  tasks: readonly Date[];
  /** When notes were written (created). */
  notes: readonly Date[];
};

export type WeekCounts = { start: Date } & Record<GoalMeasure, number>;

/**
 * Eight finished weeks and this one, oldest first, each with what happened in it. Anything before the first week or after today is not
 * counted, so a date in the future (clock skew, a typed date) never makes a count. Weeks are placed by calendar day, not by milliseconds
 * (a week with a clock change is 167 or 169 hours long).
 */
export function weeklyGoalCounts(activity: GoalActivity, now: Date, history: number = GOAL_HISTORY_WEEKS): WeekCounts[] {
  const total = history + 1;
  const firstStart = addDays(startOfWeek(now), -7 * history);
  const endOfToday = addDays(startOfDay(now), 1);
  const weeks: WeekCounts[] = Array.from({ length: total }, (_, index) => ({
    start: addDays(firstStart, 7 * index),
    study_sessions: 0,
    study_minutes: 0,
    cards_reviewed: 0,
    tasks_finished: 0,
    notes_written: 0,
  }));
  const seconds = new Array<number>(total).fill(0);
  const firstNumber = dayNumber(firstStart);
  const place = (at: Date): number => {
    if (at < firstStart || at >= endOfToday) return -1;
    return Math.min(Math.floor((dayNumber(at) - firstNumber) / 7), total - 1);
  };
  for (const session of activity.sessions) {
    const index = place(session.at);
    if (index < 0) continue;
    weeks[index].study_sessions += 1;
    seconds[index] += session.seconds;
  }
  for (const at of activity.cards) {
    const index = place(at);
    if (index >= 0) weeks[index].cards_reviewed += 1;
  }
  for (const at of activity.tasks) {
    const index = place(at);
    if (index >= 0) weeks[index].tasks_finished += 1;
  }
  for (const at of activity.notes) {
    const index = place(at);
    if (index >= 0) weeks[index].notes_written += 1;
  }
  weeks.forEach((week, index) => (week.study_minutes = Math.floor(seconds[index] / 60)));
  return weeks;
}

export type Progress = { count: number; target: number; left: number; reached: boolean; fraction: number };

export function progressOf(count: number, target: number): Progress {
  return { count, target, left: Math.max(0, target - count), reached: count >= target, fraction: Math.min(1, count / target) };
}

/** The finished weeks (this one is left out: it is not over) against the target as it is now, oldest first. */
export function pastWeeks(weeks: readonly WeekCounts[], measure: GoalMeasure, target: number): { marks: boolean[]; reached: number; total: number } {
  const finished = weeks.slice(0, -1);
  const marks = finished.map((week) => week[measure] >= target);
  return { marks, reached: marks.filter(Boolean).length, total: marks.length };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 16 – Sun 22 Nov", or "Mon 30 Nov – Sun 6 Dec" across a month. */
export function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const from = `${DAY[start.getDay()]} ${start.getDate()}${start.getMonth() === end.getMonth() ? "" : ` ${MONTH[start.getMonth()]}`}`;
  return `${from} – ${DAY[end.getDay()]} ${end.getDate()} ${MONTH[end.getMonth()]}`;
}
