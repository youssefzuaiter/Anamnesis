import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_STUDY_SECONDS, STATS_WEEKS, activeDays, counted, dayKey, lastDays, startOfWeek, streaks, weeklyTotals, type Activity } from "@/lib/study-stats";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const none: Activity = { tasks: [], cards: [], study: [] };

test("a day is its local calendar date, and a week starts on Monday", () => {
  assert.equal(dayKey(at(2026, 11, 15, 23)), "2026-11-15");
  assert.equal(dayKey(new Date(2026, 10, 15, 0, 0, 0)), "2026-11-15");
  assert.equal(dayKey(new Date(2026, 10, 15, 23, 59, 59)), "2026-11-15");
  assert.equal(dayKey(at(2026, 1, 5)), "2026-01-05");
  assert.equal(dayKey(startOfWeek(at(2026, 11, 15))), "2026-11-09", "Sunday 15 Nov belongs to the week of Monday 9 Nov");
  assert.equal(dayKey(startOfWeek(at(2026, 11, 9, 0))), "2026-11-09");
  assert.equal(dayKey(startOfWeek(at(2026, 11, 16, 8))), "2026-11-16");
  assert.equal(dayKey(startOfWeek(at(2027, 1, 1))), "2026-12-28", "a week can start in the year before");
});

test("a day counts for a finished task, a reviewed card, or a minute of recorded study", () => {
  const days = activeDays({
    tasks: [at(2026, 11, 10)],
    cards: [at(2026, 11, 11)],
    study: [
      { at: at(2026, 11, 12), seconds: MIN_STUDY_SECONDS },
      { at: at(2026, 11, 13, 9), seconds: MIN_STUDY_SECONDS - 1 },
      { at: at(2026, 11, 14, 9), seconds: 30 },
      { at: at(2026, 11, 14, 15), seconds: 30 },
    ],
  });
  assert.deepEqual([...days].sort(), ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-14"]);
  assert.equal(MIN_STUDY_SECONDS, 60);
});

test("the streak ends today if today counts, else yesterday, so it is not broken until the day is over", () => {
  const now = at(2026, 11, 15, 14);
  const run = (...days: number[]) => new Set(days.map((d) => dayKey(at(2026, 11, d))));
  assert.deepEqual(streaks(run(12, 13, 14, 15), now), { current: 4, longest: 4, todayActive: true });
  assert.deepEqual(streaks(run(12, 13, 14), now), { current: 3, longest: 3, todayActive: false }, "yesterday's run still stands today");
  assert.deepEqual(streaks(run(12, 13), now), { current: 0, longest: 2, todayActive: false }, "a missed day ends it");
  assert.deepEqual(streaks(run(15), now), { current: 1, longest: 1, todayActive: true });
  assert.deepEqual(streaks(new Set(), now), { current: 0, longest: 0, todayActive: false });
});

test("the longest streak is found across gaps, month and year boundaries, and the current one can be the longest", () => {
  const now = at(2027, 1, 3);
  const days = new Set([
    ...[28, 29, 30, 31].map((d) => dayKey(at(2026, 12, d))),
    dayKey(at(2027, 1, 1)),
    dayKey(at(2027, 1, 2)),
    dayKey(at(2027, 1, 3)),
    dayKey(at(2026, 11, 1)),
    dayKey(at(2026, 11, 2)),
  ]);
  assert.deepEqual(streaks(days, now), { current: 7, longest: 7, todayActive: true });
  const old = new Set([...Array.from({ length: 10 }, (_, i) => dayKey(at(2026, 6, 1 + i))), dayKey(at(2027, 1, 3))]);
  assert.deepEqual(streaks(old, now), { current: 1, longest: 10, todayActive: true });
});

test("a clock change does not make a day disappear: walking by calendar day crosses it", () => {
  // Late March and late October are when most clocks move; the streak counts calendar days either side.
  const now = at(2026, 10, 27);
  const days = new Set(Array.from({ length: 6 }, (_, i) => dayKey(at(2026, 10, 22 + i))));
  assert.equal(streaks(days, now).current, 6);
  const spring = new Set(Array.from({ length: 5 }, (_, i) => dayKey(at(2026, 3, 27 + i))));
  assert.equal(streaks(spring, at(2026, 3, 31)).current, 5);
});

test("the last seven days are the week as it stood, oldest first, ending today", () => {
  const now = at(2026, 11, 15, 10);
  const active = new Set([dayKey(at(2026, 11, 9)), dayKey(at(2026, 11, 13)), dayKey(at(2026, 11, 15))]);
  const days = lastDays(active, now, 7);
  assert.deepEqual(days.map((d) => d.key), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.deepEqual(days.map((d) => d.label), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepEqual(days.map((d) => d.active), [true, false, false, false, true, false, true]);
  assert.equal(lastDays(active, now, 3)[0].key, "2026-11-13");
});

test("eight weekly totals, oldest first, the last one this week so far, nothing outside them and nothing from the future", () => {
  const now = at(2026, 11, 15, 12); // a Sunday: this week began Monday 9 Nov
  const activity: Activity = {
    tasks: [at(2026, 11, 9, 8), at(2026, 11, 15, 11), at(2026, 11, 8, 23), at(2026, 9, 21, 9), at(2026, 9, 20, 9), at(2026, 11, 16, 9)],
    cards: [at(2026, 11, 10), at(2026, 11, 10), at(2026, 11, 2)],
    study: [{ at: at(2026, 11, 12), seconds: 1800 }, { at: at(2026, 11, 12), seconds: 600 }, { at: at(2026, 10, 30), seconds: 300 }],
  };
  const weeks = weeklyTotals(activity, now);
  assert.equal(weeks.length, STATS_WEEKS);
  assert.equal(dayKey(weeks[7].start), "2026-11-09");
  assert.equal(dayKey(weeks[0].start), "2026-09-21");
  assert.deepEqual([weeks[7].tasks, weeks[7].cards, weeks[7].studySeconds], [2, 2, 2400]);
  assert.deepEqual([weeks[6].tasks, weeks[6].cards, weeks[6].studySeconds], [1, 1, 0], "Sunday 8 Nov and Monday 2 Nov are last week");
  assert.equal(weeks[5].studySeconds, 300);
  assert.equal(weeks[0].tasks, 1, "the first day of the first week is in; the Sunday before it is not");
  assert.equal(weeks.reduce((sum, week) => sum + week.tasks, 0), 4, "a task dated tomorrow is not counted");
});

test("with no activity every week is zero and nothing is active", () => {
  const weeks = weeklyTotals(none, at(2026, 11, 15));
  assert.deepEqual(weeks.map((week) => week.tasks + week.cards + week.studySeconds), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(activeDays(none).size, 0);
  assert.equal(lastDays(new Set(), at(2026, 11, 15), 7).every((day) => !day.active), true);
});

test("a hundred thousand timestamps are counted in well under a second", () => {
  const now = at(2026, 11, 15);
  const many = Array.from({ length: 100_000 }, (_, i) => new Date(now.getTime() - (i % 400) * 86_400_000));
  const started = performance.now();
  weeklyTotals({ tasks: many, cards: many, study: [] }, now);
  activeDays({ tasks: many, cards: many, study: [] });
  assert.ok(performance.now() - started < 1500);
});

test("weeks that hold a clock change put each day in the right week, in a zone that has one", () => {
  const before = process.env.TZ;
  try {
    for (const zone of ["Europe/Berlin", "America/New_York", "Australia/Sydney"]) {
      process.env.TZ = zone;
      // Late March, late October and early April/October are where these zones move their clocks.
      for (const [y, m, d] of [[2026, 3, 29], [2026, 10, 25], [2026, 11, 1], [2026, 4, 5], [2026, 10, 4]]) {
        const now = new Date(y, m - 1, d + 3, 12);
        const weekStart = startOfWeek(now);
        const monday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 0, 30);
        const sunday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1, 23, 30);
        const weeks = weeklyTotals({ tasks: [monday, sunday], cards: [], study: [] }, now);
        assert.equal(weeks[7].tasks, 1, `${zone} ${y}-${m}-${d}: Monday 00:30 is this week`);
        assert.equal(weeks[6].tasks, 1, `${zone} ${y}-${m}-${d}: the Sunday before, 23:30, is last week`);
        assert.equal(dayKey(weeks[7].start), dayKey(weekStart));
      }
      // And the streak crosses the change day.
      const days = new Set(Array.from({ length: 5 }, (_, i) => dayKey(new Date(2026, 9, 23 + i, 12))));
      assert.equal(streaks(days, new Date(2026, 9, 27, 12)).current, 5, `${zone}: a streak over the autumn change`);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("a count agrees with its unit: one task, no tasks, five tasks, a thousand with a separator", () => {
  assert.equal(counted(1, "task", "tasks"), "1 task");
  assert.equal(counted(0, "task", "tasks"), "0 tasks");
  assert.equal(counted(5, "card", "cards"), "5 cards");
  assert.equal(counted(1200, "min", "min"), "1,200 min");
});
