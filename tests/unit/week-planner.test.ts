import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DAY_MINUTES, MAX_WEEK_BLOCKS, planWeek, weekDays } from "@/lib/week-planner";
import { GAP_MINUTES, type Busy, type Plannable } from "@/lib/day-planner";

const NOW = new Date(2026, 10, 22, 20); // Sunday evening
const MONDAY = new Date(2026, 10, 23);
const DAYS = weekDays(MONDAY);
const at = (dayIndex: number, h: number, m = 0) => new Date(2026, 10, 23 + dayIndex, h, m);
const task = (id: string, over: Partial<Plannable> = {}): Plannable => ({ id, title: id, estimatedMinutes: 60, priority: "medium", dueDate: null, ...over });
const dayOf = (b: { start: Date }) => (b.start.getDate() - 23);
const byId = (blocks: { taskId: string; start: Date }[], id: string) => blocks.find((b) => b.taskId === id)!;

test("a week is Monday to Sunday by calendar day", () => {
  assert.deepEqual(DAYS.map((d) => d.getDate()), [23, 24, 25, 26, 27, 28, 29]);
  assert.ok(DAYS.every((d) => d.getHours() === 0));
});

test("tasks spread over the lightest weekdays, earlier day on a tie, in the first free gap", () => {
  const { blocks } = planWeek(DAYS, [], [task("a"), task("b"), task("c"), task("d"), task("e"), task("f")], NOW);
  assert.equal(blocks.length, 6);
  const perDay = DAYS.map((_, i) => blocks.filter((b) => dayOf(b) === i).length);
  assert.deepEqual(perDay, [2, 1, 1, 1, 1, 0, 0], "weekdays first, the extra on the earliest, nothing on the weekend");
  for (let i = 0; i < 5; i++) assert.equal(blocks.filter((b) => dayOf(b) === i)[0].start.getHours(), 9, "the first block of a day takes the first free gap, at 09:00");
});

test("a booked day is heavier, so a task goes to a lighter one", () => {
  const busy: Busy[] = [{ start: at(0, 9), end: at(0, 17) }];
  const { blocks } = planWeek(DAYS, busy, [task("a")], NOW);
  assert.equal(dayOf(blocks[0]), 1, "Monday is booked for eight hours; Tuesday is empty");
});

test("blocks never overlap what is booked, keep 10 minutes between each other and are never shortened (the shorter first on a tie)", () => {
  const busy: Busy[] = [{ start: at(0, 9), end: at(0, 12) }];
  const { blocks } = planWeek([DAYS[0]], busy, [task("a", { estimatedMinutes: 90 }), task("b", { estimatedMinutes: 45 })], NOW);
  assert.deepEqual(blocks.map((b) => [b.taskId, b.start.getHours() * 60 + b.start.getMinutes(), b.minutes]), [["b", 12 * 60, 45], ["a", 12 * 60 + 45 + GAP_MINUTES, 90]]);
});

test("a task due this week goes on or before its due day, and never after", () => {
  const { blocks, unplaced } = planWeek(DAYS, [], [task("due-tue", { dueDate: at(1, 23, 59), priority: "high" })], NOW);
  assert.ok(dayOf(blocks[0]) <= 1);
  assert.deepEqual(unplaced, []);
  // Tuesday is full: the task is due Tuesday, so Wednesday is not an option.
  const full = planWeek(DAYS, [{ start: at(0, 9), end: at(0, 21) }, { start: at(1, 9), end: at(1, 21) }], [task("due-tue", { dueDate: at(1, 23, 59) })], NOW);
  assert.deepEqual(full.blocks, []);
  assert.deepEqual(full.unplaced.map((u) => [u.taskId, u.reason]), [["due-tue", "before-due"]]);
});

test("a task due on the weekend is planned on a weekday first, on the weekend only when the weekdays are full", () => {
  const sat = at(5, 23, 59);
  assert.ok(dayOf(planWeek(DAYS, [], [task("t", { dueDate: sat })], NOW).blocks[0]) <= 4);
  const busyWeek: Busy[] = [0, 1, 2, 3, 4].map((i) => ({ start: at(i, 9), end: at(i, 21) }));
  assert.equal(dayOf(planWeek(DAYS, busyWeek, [task("t", { dueDate: sat })], NOW).blocks[0]), 5);
  assert.equal(dayOf(planWeek(DAYS, busyWeek, [task("u")], NOW).blocks[0]), 5, "a task with no due date uses the weekend when the weekdays are full");
});

test("overdue tasks go first, on the first day with room", () => {
  const { blocks } = planWeek(DAYS, [], [task("normal", { priority: "high" }), task("late", { priority: "low", dueDate: new Date(2026, 10, 18, 23, 59) })], NOW);
  assert.equal(byId(blocks, "late").start.getTime(), at(0, 9).getTime());
  assert.ok(byId(blocks, "normal").start.getTime() > byId(blocks, "late").start.getTime() || dayOf(byId(blocks, "normal")) > 0);
});

test("highest priority first, then soonest due: the one that cannot fit is the less urgent", () => {
  const one = [DAYS[0]];
  const { blocks, unplaced } = planWeek(one, [{ start: at(0, 9), end: at(0, 19, 30) }], [task("low", { priority: "low", estimatedMinutes: 60 }), task("high", { priority: "high", estimatedMinutes: 60 })], NOW);
  assert.deepEqual(blocks.map((b) => b.taskId), ["high"]);
  assert.deepEqual(unplaced.map((u) => u.taskId), ["low"]);
});

test("at most six hours of tasks a day, and a task longer than any gap is left out with its reason", () => {
  const { blocks, unplaced } = planWeek([DAYS[0]], [], Array.from({ length: 8 }, (_, i) => task(`t${i}`, { estimatedMinutes: 60 })), NOW);
  assert.equal(blocks.reduce((sum, b) => sum + b.minutes, 0), MAX_DAY_MINUTES);
  assert.equal(unplaced.length, 2);
  const huge = planWeek(DAYS, [], [task("huge", { estimatedMinutes: 600 })], NOW);
  assert.deepEqual(huge.unplaced.map((u) => [u.taskId, u.reason]), [["huge", "no-room"]]);
});

test("a week that has begun is planned from now: earlier days and passed time are never used", () => {
  const thursdayNoon = new Date(2026, 10, 26, 12);
  const { blocks } = planWeek(DAYS, [], [task("a"), task("b"), task("c")], thursdayNoon);
  assert.ok(blocks.every((b) => b.start.getTime() >= thursdayNoon.getTime()));
  assert.ok(blocks.every((b) => dayOf(b) >= 3));
});

test("a plan holds at most 40 blocks and the same data always gives the same plan", () => {
  const many = Array.from({ length: 60 }, (_, i) => task(`t${String(i).padStart(2, "0")}`, { estimatedMinutes: 15 }));
  const a = planWeek(DAYS, [], many, NOW);
  assert.equal(a.blocks.length, MAX_WEEK_BLOCKS);
  assert.equal(a.unplaced.length, 20);
  const b = planWeek(DAYS, [], [...many].reverse(), NOW);
  assert.deepEqual(b.blocks.map((x) => [x.taskId, x.start.getTime()]), a.blocks.map((x) => [x.taskId, x.start.getTime()]));
});

test("nothing to plan, or a week with no gaps, is an empty plan", () => {
  assert.deepEqual(planWeek(DAYS, [], [], NOW), { blocks: [], unplaced: [] });
  const wall: Busy[] = DAYS.map((_, i) => ({ start: at(i, 0), end: at(i + 1, 0) }));
  const r = planWeek(DAYS, wall, [task("a"), task("b")], NOW);
  assert.deepEqual(r.blocks, []);
  assert.equal(r.unplaced.length, 2);
});

test("sixty tasks over a busy week plan in well under a second", () => {
  const busy: Busy[] = DAYS.flatMap((_, i) => [{ start: at(i, 10), end: at(i, 11, 30) }, { start: at(i, 14), end: at(i, 15) }]);
  const t = Date.now();
  planWeek(DAYS, busy, Array.from({ length: 60 }, (_, i) => task(`t${i}`, { estimatedMinutes: 30 + (i % 4) * 15, priority: ["high", "medium", "low"][i % 3] })), NOW);
  assert.ok(Date.now() - t < 1000);
});

import { isoDay, parseWeekParam } from "@/lib/week-planner";

test("the week in the address is the Monday of the day named, and anything else is no week", () => {
  assert.equal(isoDay(parseWeekParam("2026-11-26")!), "2026-11-23");
  assert.equal(isoDay(parseWeekParam("2026-11-23")!), "2026-11-23");
  assert.equal(isoDay(parseWeekParam("2026-11-29")!), "2026-11-23");
  for (const bad of [undefined, ["2026-11-23", "2026-11-30"], "", "2026-13-01", "2026-02-30", "23-11-2026", "2026-11-23T00:00", "abc", "x".repeat(10_000)]) {
    assert.equal(parseWeekParam(bad as never), null, String(bad).slice(0, 20));
  }
});
