import { test } from "node:test";
import assert from "node:assert/strict";
import {
  busyFrom,
  planDay,
  freeIntervals,
  DAY_START_HOUR,
  DAY_END_HOUR,
  type Plannable,
} from "@/lib/day-planner";

const DAY = new Date(2026, 8, 15);
const EARLY = new Date(2026, 8, 15, 8, 0);

function at(hour: number, minute = 0): Date {
  return new Date(2026, 8, 15, hour, minute);
}

function task(
  id: string,
  estimatedMinutes: number,
  priority = "medium",
  dueDate: Date | null = null,
): Plannable {
  return { id, title: id, estimatedMinutes, priority, dueDate };
}

test("a clear day is one gap between the working hours", () => {
  const free = freeIntervals(DAY, [], EARLY);
  assert.equal(free.length, 1);
  assert.equal(free[0].start.getHours(), DAY_START_HOUR);
  assert.equal(free[0].end.getHours(), DAY_END_HOUR);
});

test("a commitment splits the day around it", () => {
  const free = freeIntervals(DAY, [{ start: at(10), end: at(12) }], EARLY);
  assert.equal(free.length, 2);
  assert.equal(free[0].end.getHours(), 10);
  assert.equal(free[1].start.getHours(), 12);
});

test("overlapping commitments merge rather than producing a negative gap", () => {
  const free = freeIntervals(
    DAY,
    [
      { start: at(10), end: at(12) },
      { start: at(11), end: at(14) },
    ],
    EARLY,
  );
  assert.equal(free.length, 2);
  assert.equal(free[1].start.getHours(), 14);
});

test("time already past is never planned into", () => {
  const free = freeIntervals(DAY, [], at(15));
  assert.equal(free[0].start.getHours(), 15);
});

test("a day already over has no free time", () => {
  assert.deepEqual(freeIntervals(DAY, [], at(23)), []);
});

test("nothing is scheduled over an existing commitment", () => {
  const plan = planDay(
    DAY,
    [{ start: at(10), end: at(12) }],
    [task("a", 60), task("b", 60), task("c", 60)],
    EARLY,
  );

  for (const block of plan) {
    const clashes = block.start < at(12) && block.end > at(10);
    assert.ok(!clashes, `${block.taskId} overlaps the commitment`);
  }
});

test("higher priority is placed before lower priority when both fit", () => {
  const plan = planDay(
    DAY,
    [],
    [task("low", 60, "low"), task("high", 60, "high")],
    EARLY,
  );
  assert.equal(plan[0].taskId, "high");
});

test("an earlier due date wins within the same priority", () => {
  const plan = planDay(
    DAY,
    [],
    [
      task("later", 60, "medium", new Date(2026, 8, 30)),
      task("sooner", 60, "medium", new Date(2026, 8, 16)),
    ],
    EARLY,
  );
  assert.equal(plan[0].taskId, "sooner");
});

test("a task too long for an early gap waits rather than being trimmed", () => {
  // 09:00-10:00 free, then a commitment until 12:00.
  const plan = planDay(
    DAY,
    [{ start: at(10), end: at(12) }],
    [task("long", 90, "high")],
    EARLY,
  );

  assert.equal(plan.length, 1);
  assert.equal(plan[0].start.getHours(), 12);
  assert.equal(
    (plan[0].end.getTime() - plan[0].start.getTime()) / 60000,
    90,
    "the block keeps its full estimate",
  );
});

test("blocks do not run back to back", () => {
  const plan = planDay(DAY, [], [task("a", 60), task("b", 60)], EARLY);
  assert.ok(plan[1].start.getTime() > plan[0].end.getTime());
});

test("work that cannot fit the day is left out, not squeezed in", () => {
  const plan = planDay(DAY, [], [task("huge", 10_000)], EARLY);
  assert.deepEqual(plan, []);
});

test("the returned plan is in chronological order", () => {
  const plan = planDay(
    DAY,
    [],
    [task("a", 30, "low"), task("b", 30, "high"), task("c", 30, "medium")],
    EARLY,
  );
  const starts = plan.map((block) => block.start.getTime());
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test("busyFrom counts events and planned blocks, and skips a block with no end", () => {
  const busy = busyFrom(
    [{ startTime: at(9), endTime: at(10) }],
    [
      { scheduledStart: at(13), scheduledEnd: at(14) },
      { scheduledStart: at(15), scheduledEnd: null },
      { scheduledStart: null, scheduledEnd: null },
    ],
  );
  assert.deepEqual(busy, [
    { start: at(9), end: at(10) },
    { start: at(13), end: at(14) },
  ]);
});
