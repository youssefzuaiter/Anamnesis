/**
 * Spreads unscheduled tasks across the free time of a week (ROADMAP item 51), with the day planner's gap rule: the free gaps of each day come from
 * `freeIntervals`, a block goes in the first gap with room, 10 minutes after the last, and a task is never shortened or split. Pure arithmetic, no
 * model, like the day planner.
 *
 * Which day: overdue tasks first, then highest priority, then soonest due. A task due this week goes on or before its due day, on the lightest day
 * that fits (booked plus planned minutes; the earlier day on a tie); a task due later or with no due date goes on the lightest weekday that fits.
 * Weekends are used only when no weekday in range has room. At most six hours of planned tasks a day.
 */

import { addDays, startOfDay, startOfWeek } from "@/lib/study-stats";
import {
  DAY_END_HOUR, DAY_START_HOUR, GAP_MINUTES, MIN_USABLE_MINUTES, byUrgency, freeIntervals,
  type Busy, type Plannable, type PlannedBlock,
} from "@/lib/day-planner";

export const MAX_DAY_MINUTES = 360;
/** Tasks read for a plan, and blocks a plan may hold. */
export const MAX_WEEK_TASKS = 60;
export const MAX_WEEK_BLOCKS = 40;

export type WeekBlock = PlannedBlock & { priority: string; dueDate: Date | null; minutes: number };
export type Unplaced = { taskId: string; title: string; minutes: number; dueDate: Date | null; reason: "before-due" | "no-room" };
export type WeekPlan = { blocks: WeekBlock[]; unplaced: Unplaced[] };

const dayKey = (d: Date) => d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** The seven days of the week that starts at `monday` (a local midnight). */
export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startOfDay(monday), i));
}

/** Booked minutes inside the planning hours of `day`, for telling a light day from a heavy one. */
export function bookedMinutes(day: Date, busy: Busy[]): number {
  const from = new Date(day); from.setHours(DAY_START_HOUR, 0, 0, 0);
  const to = new Date(day); to.setHours(DAY_END_HOUR, 0, 0, 0);
  const slots = busy
    .map((b) => ({ s: Math.max(b.start.getTime(), from.getTime()), e: Math.min(b.end.getTime(), to.getTime()) }))
    .filter((b) => b.e > b.s)
    .sort((a, b) => a.s - b.s);
  let total = 0;
  let cursor = -Infinity;
  for (const slot of slots) {
    const s = Math.max(slot.s, cursor);
    if (slot.e > s) total += (slot.e - s) / 60_000;
    cursor = Math.max(cursor, slot.e);
  }
  return total;
}

export function planWeek(days: Date[], busy: Busy[], tasks: Plannable[], now: Date): WeekPlan {
  const state = days.map((day) => ({
    day,
    gaps: freeIntervals(day, busy, now).map((gap) => ({ cursor: new Date(gap.start), end: gap.end })),
    booked: bookedMinutes(day, busy),
    planned: 0,
  }));
  const today = dayKey(startOfDay(now));
  const overdue = (t: Plannable) => t.dueDate !== null && dayKey(t.dueDate) < today;
  const order = [...tasks].slice(0, MAX_WEEK_TASKS).sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || byUrgency(a, b) || (a.id < b.id ? -1 : 1));

  const blocks: WeekBlock[] = [];
  const unplaced: Unplaced[] = [];

  for (const task of order) {
    const needed = Math.max(MIN_USABLE_MINUTES, task.estimatedMinutes);
    const late = overdue(task);
    // Days a task may take: up to its due day when that falls in this week; every day when it is overdue or due later.
    const dueKey = task.dueDate ? dayKey(task.dueDate) : Infinity;
    const limited = !late && dueKey < dayKey(days[days.length - 1]);
    const range = state.filter((s) => late || dayKey(s.day) <= dueKey);
    const fits = (s: (typeof state)[number]) =>
      s.planned + needed <= MAX_DAY_MINUTES && s.gaps.some((g) => (g.end.getTime() - g.cursor.getTime()) / 60_000 >= needed);
    const pool = [range.filter((s) => !isWeekend(s.day) && fits(s)), range.filter((s) => isWeekend(s.day) && fits(s))].find((p) => p.length > 0) ?? [];

    if (pool.length === 0 || blocks.length >= MAX_WEEK_BLOCKS) {
      unplaced.push({ taskId: task.id, title: task.title, minutes: needed, dueDate: task.dueDate, reason: limited ? "before-due" : "no-room" });
      continue;
    }
    const pick = late
      ? pool[0]
      : pool.reduce((best, s) => (s.booked + s.planned < best.booked + best.planned ? s : best), pool[0]);
    const gap = pick.gaps.find((g) => (g.end.getTime() - g.cursor.getTime()) / 60_000 >= needed)!;
    const start = new Date(gap.cursor);
    const end = new Date(start.getTime() + needed * 60_000);
    blocks.push({ taskId: task.id, title: task.title, start, end, priority: task.priority, dueDate: task.dueDate, minutes: needed });
    gap.cursor = new Date(end.getTime() + GAP_MINUTES * 60_000);
    pick.planned += needed;
  }
  return { blocks: blocks.sort((a, b) => a.start.getTime() - b.start.getTime()), unplaced };
}

/** `?week=yyyy-mm-dd` as the Monday of its week, or null for anything else (a repeated parameter, a malformed or impossible day). */
export function parseWeekParam(value: string | string[] | undefined): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (date.getFullYear() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) return null;
  return startOfWeek(date);
}

/** A local day as `yyyy-mm-dd`. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
