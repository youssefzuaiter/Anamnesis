// The rules of the calendar's hourly grid: which items are drawn in a column and which in the all-day strip, how
// overlaps share a column, how a pixel maps to a time, and the one piece of arithmetic for moving, resizing,
// nudging and dropping a block, shared by the browser (which moves a block before the server has answered) and
// the tests that hold the server to the same limits. Pure: no Prisma, no React.
//
// Time is epoch milliseconds, but every step is taken on the local wall clock: a day is a calendar day, not 24
// hours, so a block at 09:00 is still at 09:00 the day after the clocks change.

import { dayBounds } from "@/lib/day";
import { TASK_MINUTES_MIME_PREFIX } from "@/lib/domain";

export const SLOT_MINUTES = 15;
export const MIN_BLOCK_MINUTES = 15;
export const MINUTES_PER_DAY = 1440;
export const HOUR_PX = 56;
/** The grid opens scrolled to here, 07:00. */
export const OPEN_AT_MINUTES = 7 * 60;

export type Range = { start: number; end: number };

export type GridItem = {
  key: string;
  kind: "event" | "block";
  id: string;
  title: string;
  start: number;
  end: number;
  done: boolean;
  recurring: boolean;
  /** An imported event: its feed puts it back at the next sync, so it cannot be moved here. */
  locked: boolean;
  location: string | null;
};

/** An item that is not inside one day, with the first and last column (0-based, inclusive) it touches. */
export type StripItem = GridItem & { from: number; to: number };

export type GridDay = { date: number; isToday: boolean; items: GridItem[] };

/** What the grid needs of a calendar day; `CalendarDay` in the event service satisfies it. */
export type CalendarDayLike = {
  date: Date;
  isToday: boolean;
  events: {
    id: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location: string | null;
    recurrenceId: string | null;
    subscriptionId: string | null;
  }[];
  tasks: { id: string; title: string; start: Date; end: Date; done: boolean; recurring: boolean }[];
};

const dayStartOf = (ms: number): number => dayBounds(new Date(ms)).from.getTime();
const nextMidnightOf = (ms: number): number => dayBounds(new Date(ms)).to.getTime();

/** `minutes` after the local midnight of the day containing `day`, on the wall clock (1440 reaches the next midnight). */
function wall(day: number, minutes: number): number {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes).getTime();
}

function addCalendarDays(day: number, days: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** True when the item starts and ends on one local day; ending exactly at the next midnight still counts. */
export function sameDay(start: number, end: number): boolean {
  return end <= nextMidnightOf(start);
}

const byStartThenKey = (a: GridItem, b: GridItem) => a.start - b.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * Splits the calendar's days into what the grid draws: an item inside one day goes to that day's column (and only
 * there, even though the calendar lists an item that ends at midnight under the next day too); anything else goes
 * once to the all-day strip, with the first and last column it touches.
 */
export function toGrid(days: readonly CalendarDayLike[]): { days: GridDay[]; strip: StripItem[] } {
  const columns: GridDay[] = days.map((day) => ({ date: day.date.getTime(), isToday: day.isToday, items: [] }));
  const strip = new Map<string, StripItem>();

  days.forEach((day, column) => {
    const from = day.date.getTime();
    const to = nextMidnightOf(from);
    const items: GridItem[] = [
      ...day.events.map(
        (e): GridItem => ({
          key: `event:${e.id}`,
          kind: "event",
          id: e.id,
          title: e.title,
          start: e.startTime.getTime(),
          end: e.endTime.getTime(),
          done: false,
          recurring: e.recurrenceId !== null,
          locked: e.subscriptionId !== null,
          location: e.location,
        }),
      ),
      ...day.tasks.map(
        (t): GridItem => ({
          key: `block:${t.id}`,
          kind: "block",
          id: t.id,
          title: t.title,
          start: t.start.getTime(),
          end: t.end.getTime(),
          done: t.done,
          recurring: t.recurring,
          locked: false,
          location: null,
        }),
      ),
    ];
    for (const item of items) {
      if (sameDay(item.start, item.end)) {
        if (item.start >= from && item.start < to) columns[column].items.push(item);
        continue;
      }
      const seen = strip.get(item.key);
      if (seen) seen.to = column;
      else strip.set(item.key, { ...item, from: column, to: column });
    }
  });

  for (const column of columns) column.items.sort(byStartThenKey);
  return { days: columns, strip: [...strip.values()].sort(byStartThenKey) };
}

/**
 * Gives each item a lane and the number of lanes in its cluster (a run of items joined by overlaps), so items that
 * overlap are drawn side by side and a lane is reused once its item has ended. Input order is kept.
 */
export function layoutDay<T extends { start: number; end: number }>(items: readonly T[]): (T & { lane: number; lanes: number })[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start || items[a].end - items[b].end || a - b);
  const lane = new Array<number>(items.length);
  const cluster = new Array<number>(items.length);
  const widest: number[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  let id = -1;

  for (const i of order) {
    const item = items[i];
    if (item.start >= clusterEnd) {
      id += 1;
      laneEnds = [];
    }
    let l = laneEnds.findIndex((end) => end <= item.start);
    if (l === -1) {
      l = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[l] = item.end;
    }
    lane[i] = l;
    cluster[i] = id;
    widest[id] = laneEnds.length;
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  return items.map((item, i) => ({ ...item, lane: lane[i], lanes: widest[cluster[i]] }));
}

/** Wall-clock minutes after the local midnight of `day`, 0 to 1440; a time at or past the next midnight is 1440. */
export function minutesIn(day: number, at: number): number {
  if (at <= day) return 0;
  if (at >= nextMidnightOf(day)) return MINUTES_PER_DAY;
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES + 0;
}

export function topPx(minutes: number): number {
  return (minutes * HOUR_PX) / 60;
}

/** The time under a vertical position in the grid, snapped to a quarter hour and kept inside the day. */
export function minutesAtY(px: number): number {
  return clamp(snapMinutes((px * 60) / HOUR_PX), 0, MINUTES_PER_DAY);
}

/**
 * The range moved by `minutes` (snapped) and `days` (calendar days, keeping the wall clock). It keeps its length
 * and stops at the edges of its day, so a drag past midnight sticks to midnight.
 */
export function moveRange(range: Range, minutes: number, days: number): Range {
  const day = dayStartOf(range.start);
  const start = minutesIn(day, range.start);
  const length = minutesIn(day, range.end) - start;
  const moved = clamp(start + snapMinutes(minutes), 0, Math.max(0, MINUTES_PER_DAY - length));
  const target = addCalendarDays(day, days);
  return { start: wall(target, moved), end: wall(target, moved + length) };
}

/** One edge moved by `minutes` (snapped): never under 15 minutes, never outside the day, the other edge fixed. */
export function resizeRange(range: Range, edge: "start" | "end", minutes: number): Range {
  const day = dayStartOf(range.start);
  let start = minutesIn(day, range.start);
  let end = minutesIn(day, range.end);
  const by = snapMinutes(minutes);
  if (edge === "end") end = clamp(end + by, start + MIN_BLOCK_MINUTES, MINUTES_PER_DAY);
  else start = clamp(start + by, 0, end - MIN_BLOCK_MINUTES);
  return { start: wall(day, start), end: wall(day, end) };
}

export type NudgeOp = "earlier" | "later" | "shorter" | "longer" | "previousDay" | "nextDay";

/** What one of the selection bar's buttons does, or null when there is no room for it. */
export function nudge(range: Range, op: NudgeOp): Range | null {
  const day = dayStartOf(range.start);
  const start = minutesIn(day, range.start);
  const end = minutesIn(day, range.end);
  switch (op) {
    case "earlier":
      return start - SLOT_MINUTES < 0 ? null : moveRange(range, -SLOT_MINUTES, 0);
    case "later":
      return end + SLOT_MINUTES > MINUTES_PER_DAY ? null : moveRange(range, SLOT_MINUTES, 0);
    case "shorter":
      return end - start <= MIN_BLOCK_MINUTES ? null : resizeRange(range, "end", -SLOT_MINUTES);
    case "longer":
      return end + SLOT_MINUTES > MINUTES_PER_DAY ? null : resizeRange(range, "end", SLOT_MINUTES);
    case "previousDay":
      return moveRange(range, 0, -1);
    case "nextDay":
      return moveRange(range, 0, 1);
  }
}

/**
 * Where a task dropped on a day lands: it starts at the pointer's quarter hour and runs for its estimate (15
 * minutes to a day); if that would pass midnight it starts earlier instead of being cut.
 */
export function dropRange(day: number, minutes: number, estimateMinutes: number): Range {
  const length = clamp(Math.round(estimateMinutes), MIN_BLOCK_MINUTES, MINUTES_PER_DAY);
  const start = clamp(snapMinutes(minutes), 0, MINUTES_PER_DAY - length);
  return { start: wall(day, start), end: wall(day, start + length) };
}

/**
 * The columns with one item given a new range: it leaves the column it was in and goes to the one holding its new
 * start, sorted among that column's items. It is dropped if no shown column holds the new start (a move to a day
 * that is not on screen). Nothing is changed in place: the browser shows the move before the server has answered.
 */
export function applyRange(days: readonly GridDay[], key: string, range: Range): GridDay[] {
  const moved = days.flatMap((day) => day.items).find((candidate) => candidate.key === key);
  if (!moved) return [...days];
  const updated: GridItem = { ...moved, start: range.start, end: range.end };
  const column = days.findIndex((day) => range.start >= day.date && range.start < nextMidnightOf(day.date));
  return days.map((day, index) => {
    const rest = day.items.filter((candidate) => candidate.key !== key);
    if (index !== column) return rest.length === day.items.length ? day : { ...day, items: rest };
    return { ...day, items: [...rest, updated].sort(byStartThenKey) };
  });
}

/** The task's estimate in minutes, read from the types of a drag that came from the tray; null if there is none. */
export function estimateFromDragTypes(types: readonly string[]): number | null {
  const type = types.find((candidate) => candidate.startsWith(TASK_MINUTES_MIME_PREFIX));
  const digits = type?.slice(TASK_MINUTES_MIME_PREFIX.length);
  return digits !== undefined && /^[1-9]\d{0,3}$/.test(digits) ? Number(digits) : null;
}

/** The times a block may have: 2000 to 2100, as epoch milliseconds (the browser's numbers are checked against it). */
export const TIME_WINDOW = { from: Date.UTC(2000, 0, 1), to: Date.UTC(2100, 0, 1) } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The server's rule for a time range that came from the browser: whole milliseconds, both inside 2000 to 2100,
 * the end after the start, at most a day. The message to show, or null when it is fine.
 */
export function checkRange(start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "That is not a time.";
  if (start < TIME_WINDOW.from || start > TIME_WINDOW.to || end < TIME_WINDOW.from || end > TIME_WINDOW.to) return "That time is out of range.";
  if (end <= start) return "A block must end after it starts.";
  if (end - start > DAY_MS) return "A block can be at most a day long.";
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "15:30–17:00": the 24-hour local times the grid shows. */
export function formatRange(range: Range): string {
  return `${clock(range.start)}–${clock(range.end)}`;
}
