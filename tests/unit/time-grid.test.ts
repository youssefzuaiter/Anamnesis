import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOUR_PX,
  MIN_BLOCK_MINUTES,
  MINUTES_PER_DAY,
  OPEN_AT_MINUTES,
  SLOT_MINUTES,
  checkRange,
  dropRange,
  formatRange,
  layoutDay,
  minutesAtY,
  minutesIn,
  moveRange,
  nudge,
  resizeRange,
  sameDay,
  snapMinutes,
  toGrid,
  topPx,
  type CalendarDayLike,
  type NudgeOp,
  type Range,
} from "@/lib/time-grid";

// Local wall-clock times throughout: a calendar day is a local day, never 24 hours.
const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m, 0, 0).getTime();
const dayOf = (d: number) => at(d);
const hm = (ms: number) => {
  const date = new Date(ms);
  return `${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const range = (d: number, h1: number, m1: number, h2: number, m2: number): Range => ({ start: at(d, h1, m1), end: at(d, h2, m2) });

test("the grid's constants are the design's", () => {
  assert.equal(SLOT_MINUTES, 15);
  assert.equal(MIN_BLOCK_MINUTES, 15);
  assert.equal(MINUTES_PER_DAY, 1440);
  assert.equal(HOUR_PX, 56);
  assert.equal(OPEN_AT_MINUTES, 7 * 60);
});

// --- what is drawn where -----------------------------------------------------------------------

function calendarDay(d: number, parts: Partial<Pick<CalendarDayLike, "events" | "tasks">> = {}, isToday = false): CalendarDayLike {
  return { date: new Date(2026, 10, d), isToday, events: [], tasks: [], ...parts };
}
const event = (id: string, start: number, end: number, over: Partial<CalendarDayLike["events"][number]> = {}) => ({
  id,
  title: `Event ${id}`,
  startTime: new Date(start),
  endTime: new Date(end),
  location: null,
  recurrenceId: null,
  subscriptionId: null,
  ...over,
});
const block = (id: string, start: number, end: number, over: Partial<CalendarDayLike["tasks"][number]> = {}) => ({
  id,
  title: `Block ${id}`,
  start: new Date(start),
  end: new Date(end),
  done: false,
  recurring: false,
  ...over,
});

test("an item that starts and ends on one day is a grid item of that day", () => {
  const e = event("e1", at(9, 9), at(9, 10, 30));
  const b = block("b1", at(9, 14), at(9, 16));
  const { days, strip } = toGrid([calendarDay(9, { events: [e], tasks: [b] }), calendarDay(10)]);
  assert.deepEqual(days[0].items.map((i) => [i.kind, i.id, i.start, i.end]), [["event", "e1", at(9, 9), at(9, 10, 30)], ["block", "b1", at(9, 14), at(9, 16)]]);
  assert.equal(days[1].items.length, 0);
  assert.deepEqual(strip, []);
  assert.equal(days[0].date, dayOf(9));
});

test("an item that ends exactly at midnight is still that day's", () => {
  const { days, strip } = toGrid([calendarDay(9, { events: [event("late", at(9, 22), at(10, 0))] }), calendarDay(10, { events: [event("late", at(9, 22), at(10, 0))] })]);
  assert.equal(days[0].items.length, 1);
  assert.equal(days[1].items.length, 0, "it is not also drawn in the next day");
  assert.deepEqual(strip, []);
});

test("an item across days goes once to the strip, with its first and last column", () => {
  const span = event("hack", at(13, 18), at(14, 12));
  const { days, strip } = toGrid([13, 14, 15].map((d, i) => calendarDay(d, i < 2 ? { events: [span] } : {})));
  assert.equal(strip.length, 1);
  assert.deepEqual([strip[0].id, strip[0].from, strip[0].to], ["hack", 0, 1]);
  assert.deepEqual(days.map((d) => d.items.length), [0, 0, 0]);
});

test("an imported event is locked; a block and an event keep what the page shows", () => {
  const { days } = toGrid([
    calendarDay(9, {
      events: [event("imp", at(9, 9), at(9, 10), { subscriptionId: "sub", recurrenceId: "series", location: "Hall C" })],
      tasks: [block("done", at(9, 11), at(9, 12), { done: true, recurring: true })],
    }),
  ]);
  const [imp, done] = days[0].items;
  assert.equal(imp.locked, true);
  assert.equal(imp.recurring, true);
  assert.equal(imp.location, "Hall C");
  assert.equal(done.locked, false);
  assert.equal(done.done, true);
  assert.equal(done.recurring, true);
  assert.notEqual(imp.key, done.key);
});

test("items in a day are in time order, then by key", () => {
  const { days } = toGrid([
    calendarDay(9, { events: [event("b", at(9, 10), at(9, 11)), event("a", at(9, 10), at(9, 11)), event("early", at(9, 8), at(9, 9))] }),
  ]);
  assert.deepEqual(days[0].items.map((i) => i.id), ["early", "a", "b"]);
});

test("today is carried through", () => {
  const { days } = toGrid([calendarDay(9), calendarDay(10, {}, true)]);
  assert.deepEqual(days.map((d) => d.isToday), [false, true]);
});

test("same day means the same local day, midnight at the end included", () => {
  assert.equal(sameDay(at(9, 9), at(9, 10)), true);
  assert.equal(sameDay(at(9, 22), at(10, 0)), true);
  assert.equal(sameDay(at(9, 22), at(10, 0, 1)), false);
  assert.equal(sameDay(at(9, 0), at(10, 0)), true);
});

// --- overlaps ----------------------------------------------------------------------------------

const span = (s: number, e: number) => ({ start: s, end: e });

test("two items that overlap sit side by side; one after both has the full width", () => {
  const laid = layoutDay([span(at(9, 9), at(9, 11)), span(at(9, 10), at(9, 12)), span(at(9, 13), at(9, 14))]);
  assert.deepEqual(laid.map((i) => [i.lane, i.lanes]), [[0, 2], [1, 2], [0, 1]]);
});

test("a chain of overlaps shares one width, and items that merely touch do not overlap", () => {
  const chain = layoutDay([span(at(9, 9), at(9, 10)), span(at(9, 9, 30), at(9, 11)), span(at(9, 10, 30), at(9, 12))]);
  assert.deepEqual(chain.map((i) => [i.lane, i.lanes]), [[0, 2], [1, 2], [0, 2]], "A and C do not overlap, but B joins them: one cluster, two lanes");
  const touching = layoutDay([span(at(9, 9), at(9, 10)), span(at(9, 10), at(9, 11))]);
  assert.deepEqual(touching.map((i) => [i.lane, i.lanes]), [[0, 1], [0, 1]]);
});

test("an item that only touches a crowded cluster starts a new one, and takes a lane its neighbour has left", () => {
  // Two items side by side, then one starting exactly as both end: it has the full width.
  const after = layoutDay([span(at(9, 9), at(9, 10)), span(at(9, 9), at(9, 10)), span(at(9, 10), at(9, 11))]);
  assert.deepEqual(after.map((i) => [i.lane, i.lanes]), [[0, 2], [1, 2], [0, 1]]);
  // One starting exactly as the first of two overlapping items ends takes that item's lane.
  const reuse = layoutDay([span(at(9, 9), at(9, 10)), span(at(9, 9, 30), at(9, 10, 30)), span(at(9, 10), at(9, 11))]);
  assert.deepEqual(reuse.map((i) => [i.lane, i.lanes]), [[0, 2], [1, 2], [0, 2]]);
});

test("a lane is reused once its item has ended", () => {
  const laid = layoutDay([span(at(9, 9), at(9, 12)), span(at(9, 9, 30), at(9, 10)), span(at(9, 10, 30), at(9, 11))]);
  assert.deepEqual(laid.map((i) => i.lane), [0, 1, 1]);
});

test("a day of 5,000 items is laid out in milliseconds", () => {
  const many = Array.from({ length: 5000 }, (_, i) => span(at(9, 0, (i * 7) % 1200), at(9, 0, ((i * 7) % 1200) + 30)));
  const start = performance.now();
  layoutDay(many);
  const took = performance.now() - start;
  assert.ok(took < 200, `took ${took.toFixed(0)} ms`);
});

// --- geometry ----------------------------------------------------------------------------------

test("minutes in a day follow the wall clock, and an end at the next midnight is the day's end", () => {
  assert.equal(minutesIn(dayOf(9), at(9, 0)), 0);
  assert.equal(minutesIn(dayOf(9), at(9, 15, 45)), 15 * 60 + 45);
  assert.equal(minutesIn(dayOf(9), at(10, 0)), 1440);
});

test("pixels and minutes agree, snapped and clamped", () => {
  assert.equal(topPx(0), 0);
  assert.equal(topPx(60), HOUR_PX);
  assert.equal(topPx(OPEN_AT_MINUTES), 7 * HOUR_PX);
  for (const minutes of [0, 15, 90, 7 * 60, 1425]) assert.equal(minutesAtY(topPx(minutes)), minutes);
  assert.equal(minutesAtY(topPx(100) + 3), 105, "the nearest quarter hour");
  assert.equal(minutesAtY(-40), 0);
  assert.equal(minutesAtY(HOUR_PX * 30), 1440);
  assert.equal(snapMinutes(7), 0);
  assert.equal(snapMinutes(8), 15);
  assert.equal(snapMinutes(-8), -15);
  assert.equal(snapMinutes(37), 30);
});

// --- move, resize, nudge, drop -----------------------------------------------------------------

test("moving by minutes snaps to a quarter hour and keeps the length", () => {
  const moved = moveRange(range(9, 10, 0, 11, 30), 37, 0);
  assert.equal(hm(moved.start), "9 10:30");
  assert.equal(hm(moved.end), "9 12:00");
});

test("a move stops at the day's edges and keeps the length there", () => {
  const early = moveRange(range(9, 0, 30, 1, 30), -300, 0);
  assert.equal(hm(early.start), "9 00:00");
  assert.equal(hm(early.end), "9 01:00");
  const late = moveRange(range(9, 22, 0, 23, 0), 600, 0);
  assert.equal(hm(late.start), "9 23:00");
  assert.equal(hm(late.end), "10 00:00", "the end of the day is midnight");
});

test("moving by days keeps the wall clock", () => {
  const moved = moveRange(range(9, 15, 30, 17, 0), 0, 2);
  assert.equal(hm(moved.start), "11 15:30");
  assert.equal(hm(moved.end), "11 17:00");
  const back = moveRange(range(9, 15, 30, 17, 0), 15, -1);
  assert.equal(hm(back.start), "8 15:45");
  assert.equal(hm(back.end), "8 17:15");
});

test("resizing moves one edge, snapped, never under 15 minutes and never past the day", () => {
  const base = range(9, 10, 0, 11, 0);
  assert.equal(hm(resizeRange(base, "end", 22).end), "9 11:15");
  assert.equal(resizeRange(base, "end", 22).start, base.start, "the other edge stays");
  assert.equal(hm(resizeRange(base, "start", -40).start), "9 09:15");
  assert.equal(resizeRange(base, "start", -40).end, base.end);
  assert.equal(hm(resizeRange(base, "end", -600).end), "9 10:15", "the shortest a block can be");
  assert.equal(hm(resizeRange(base, "start", 600).start), "9 10:45");
  assert.equal(hm(resizeRange(base, "end", 2000).end), "10 00:00");
  assert.equal(hm(resizeRange(base, "start", -2000).start), "9 00:00");
});

test("each nudge does what its button says, and says no when there is no room", () => {
  const base = range(9, 15, 30, 17, 0);
  const cases: [NudgeOp, string, string][] = [
    ["earlier", "9 15:15", "9 16:45"],
    ["later", "9 15:45", "9 17:15"],
    ["shorter", "9 15:30", "9 16:45"],
    ["longer", "9 15:30", "9 17:15"],
    ["previousDay", "8 15:30", "8 17:00"],
    ["nextDay", "10 15:30", "10 17:00"],
  ];
  for (const [op, start, end] of cases) {
    const moved = nudge(base, op);
    assert.ok(moved, op);
    assert.deepEqual([hm(moved.start), hm(moved.end)], [start, end], op);
  }
  const nearStart = nudge(range(9, 0, 15, 1, 0), "earlier");
  assert.ok(nearStart, "a quarter hour of room is enough");
  assert.equal(hm(nearStart.start), "9 00:00");
  const nearEnd = nudge(range(9, 22, 45, 23, 45), "later");
  assert.ok(nearEnd, "exactly enough room before midnight");
  assert.equal(hm(nearEnd.end), "10 00:00");
  assert.equal(nudge(range(9, 0, 0, 1, 0), "earlier"), null, "nothing before midnight");
  assert.equal(nudge({ start: at(9, 23), end: at(10, 0) }, "later"), null, "nothing after midnight");
  assert.equal(nudge({ start: at(9, 23), end: at(10, 0) }, "longer"), null);
  assert.equal(nudge(range(9, 10, 0, 10, 15), "shorter"), null, "a 15-minute block cannot shrink");
  assert.ok(nudge(range(9, 0, 0, 1, 0), "nextDay"), "a day move is always possible");
});

test("a dropped task starts at the pointer's quarter hour and runs for its estimate", () => {
  const d = dropRange(dayOf(9), 13 * 60 + 40, 45);
  assert.equal(hm(d.start), "9 13:45");
  assert.equal(hm(d.end), "9 14:30");
  const late = dropRange(dayOf(9), 23 * 60, 90);
  assert.equal(hm(late.start), "9 22:30");
  assert.equal(hm(late.end), "10 00:00");
  assert.equal(hm(dropRange(dayOf(9), 600, 5).end), "9 10:15", "never under 15 minutes");
  const long = dropRange(dayOf(9), 600, 5000);
  assert.equal(hm(long.start), "9 00:00", "a task longer than the day fills it");
  assert.equal(hm(long.end), "10 00:00");
});

// --- daylight saving: positions follow the wall clock ------------------------------------------

function inLondon<T>(fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

test("on the days the clocks change a block keeps its wall-clock hours when it moves a day", () => {
  inLondon(() => {
    // Into and out of the 23-hour day (29 March) and the 25-hour day (25 October).
    for (const [from, to] of [
      [new Date(2026, 2, 28), new Date(2026, 2, 29)],
      [new Date(2026, 2, 29), new Date(2026, 2, 30)],
      [new Date(2026, 9, 24), new Date(2026, 9, 25)],
      [new Date(2026, 9, 25), new Date(2026, 9, 26)],
    ]) {
      const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 9, 0).getTime();
      const end = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 10, 30).getTime();
      const moved = moveRange({ start, end }, 0, 1);
      assert.equal(new Date(moved.start).getDate(), to.getDate());
      assert.equal(new Date(moved.start).getHours(), 9, "09:00 is still 09:00");
      assert.equal(new Date(moved.end).getHours(), 10);
      assert.equal(new Date(moved.end).getMinutes(), 30);
      const day = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
      assert.equal(minutesIn(day, moved.start), 9 * 60);
      assert.equal(minutesIn(day, moved.end), 10 * 60 + 30);
    }
  });
});

// --- the server's rule -------------------------------------------------------------------------

test("a range is acceptable only if both ends are real times in a sane window and it is at most a day", () => {
  const ok = at(9, 9);
  assert.equal(checkRange(ok, ok + 3_600_000), null);
  assert.equal(checkRange(ok, ok + 24 * 3_600_000), null, "exactly a day is allowed");
  assert.match(checkRange(ok, ok + 24 * 3_600_000 + 1) ?? "", /day|long/i);
  assert.match(checkRange(ok, ok) ?? "", /after/i);
  assert.match(checkRange(ok + 1, ok) ?? "", /after/i);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, ok + 0.5]) {
    assert.ok(checkRange(bad, ok + 3_600_000), `start ${bad}`);
    assert.ok(checkRange(ok, bad), `end ${bad}`);
  }
  assert.ok(checkRange(Date.UTC(1999, 11, 31), Date.UTC(1999, 11, 31) + 3_600_000), "before 2000");
  assert.ok(checkRange(Date.UTC(2101, 0, 1), Date.UTC(2101, 0, 1) + 3_600_000), "after 2100");
  assert.ok(checkRange(Date.UTC(3000, 0, 1), Date.UTC(3000, 0, 1) + 3_600_000), "the year 3000");
});

test("a range is written the way the page shows it", () => {
  assert.equal(formatRange(range(9, 15, 30, 17, 0)), "15:30–17:00");
  assert.equal(formatRange(range(9, 9, 5, 9, 45)), "09:05–09:45");
  assert.equal(formatRange({ start: at(9, 22), end: at(10, 0) }), "22:00–00:00");
});
