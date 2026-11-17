import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOAL_MEASURES, MAX_TARGET, MEASURE_NAME, DEFAULT_TARGET, needsRecorder, goalLabel, goalSchema, targetSchema, weeklyGoalCounts, progressOf, pastWeeks, weekLabel, type GoalActivity,
} from "@/lib/weekly-goals";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const none: GoalActivity = { sessions: [], cards: [], tasks: [], notes: [] };
const NOW = at(2026, 11, 18); // a Wednesday; its week is Mon 16 – Sun 22 Nov

test("the five things a goal can count, and the sentence for each target", () => {
  assert.deepEqual([...GOAL_MEASURES], ["study_sessions", "study_minutes", "cards_reviewed", "tasks_finished", "notes_written"]);
  assert.equal(goalLabel("study_sessions", 3), "3 study sessions");
  assert.equal(goalLabel("study_sessions", 1), "1 study session");
  assert.equal(goalLabel("study_minutes", 90), "90 minutes studied");
  assert.equal(goalLabel("study_minutes", 1), "1 minute studied");
  assert.equal(goalLabel("cards_reviewed", 50), "50 cards reviewed");
  assert.equal(goalLabel("cards_reviewed", 1), "1 card reviewed");
  assert.equal(goalLabel("tasks_finished", 5), "5 tasks finished");
  assert.equal(goalLabel("tasks_finished", 1), "1 task finished");
  assert.equal(goalLabel("notes_written", 2), "2 notes written");
  assert.equal(goalLabel("notes_written", 1), "1 note written");
});

test("a goal is a measure and a whole target from 1 to 999, nothing else", () => {
  assert.equal(MAX_TARGET, 999);
  assert.ok(goalSchema.safeParse({ measure: "cards_reviewed", target: 1 }).success);
  assert.ok(goalSchema.safeParse({ measure: "cards_reviewed", target: 999 }).success);
  for (const target of [0, -1, 1000, 2.5, NaN, Infinity, "5", null, undefined, {}]) assert.ok(!goalSchema.safeParse({ measure: "cards_reviewed", target }).success, JSON.stringify(target));
  for (const measure of ["steps", "", "CARDS_REVIEWED", null, undefined, ["tasks_finished"]]) assert.ok(!goalSchema.safeParse({ measure, target: 3 }).success, JSON.stringify(measure));
  assert.deepEqual(Object.keys(goalSchema.parse({ measure: "tasks_finished", target: 3, userId: "x", id: "y" })).sort(), ["measure", "target"]);
  assert.ok(targetSchema.safeParse(7).success);
  assert.ok(!targetSchema.safeParse(0).success);
});

test("each week holds what happened in it, Monday to Sunday, and the last one is this week so far", () => {
  const weeks = weeklyGoalCounts(
    {
      sessions: [{ at: at(2026, 11, 16, 9), seconds: 1500 }, { at: at(2026, 11, 18, 9), seconds: 1800 }, { at: at(2026, 11, 15, 23), seconds: 600 }],
      cards: [at(2026, 11, 22, 23), at(2026, 11, 9, 0), at(2026, 11, 8, 23)],
      tasks: [at(2026, 11, 17)],
      notes: [at(2026, 11, 16, 0), at(2026, 11, 19)],
    },
    NOW,
  );
  assert.equal(weeks.length, 9, "eight finished weeks and this one");
  const [last, before] = [weeks[8], weeks[7]];
  assert.equal(last.start.getDate(), 16);
  assert.deepEqual([last.study_sessions, last.study_minutes, last.tasks_finished], [2, 55, 1]);
  assert.equal(last.cards_reviewed, 0, "Sunday 22 Nov has not happened yet at Wednesday the 18th, so it is not counted");
  assert.equal(last.notes_written, 1, "Thursday 19 Nov is in the future; Monday 16 at midnight is in this week");
  assert.deepEqual([before.study_sessions, before.study_minutes], [1, 10], "Sunday night is the week before");
  assert.equal(before.cards_reviewed, 1);
  assert.equal(weeks[6].cards_reviewed, 1, "Sunday 8 Nov 23:00 is the week of 2 Nov; Monday 9 Nov 00:00 is the week of 9 Nov");
});

test("minutes studied are whole minutes of the week's total, not per session", () => {
  const weeks = weeklyGoalCounts({ ...none, sessions: [{ at: NOW, seconds: 40 }, { at: NOW, seconds: 40 }, { at: NOW, seconds: 40 }] }, NOW);
  assert.equal(weeks[8].study_minutes, 2, "120 seconds in all");
  assert.equal(weeks[8].study_sessions, 3);
  assert.equal(weeklyGoalCounts({ ...none, sessions: [{ at: NOW, seconds: 59 }] }, NOW)[8].study_minutes, 0);
});

test("nothing before the first week or after today ever makes a count", () => {
  const weeks = weeklyGoalCounts({ ...none, tasks: [at(2025, 1, 1), at(2027, 1, 1), at(2026, 11, 23)] }, NOW);
  assert.deepEqual(weeks.map((w) => w.tasks_finished), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("progress says how far, how many are left and whether the target is reached, exceeded included", () => {
  assert.deepEqual(progressOf(2, 3), { count: 2, target: 3, left: 1, reached: false, fraction: 2 / 3 });
  assert.deepEqual(progressOf(3, 3), { count: 3, target: 3, left: 0, reached: true, fraction: 1 });
  assert.deepEqual(progressOf(6, 5), { count: 6, target: 5, left: 0, reached: true, fraction: 1 });
  assert.deepEqual(progressOf(0, 4), { count: 0, target: 4, left: 4, reached: false, fraction: 0 });
});

test("the finished weeks are marked reached or not against the current target, and this week is left out", () => {
  const weeks = weeklyGoalCounts({ ...none, tasks: [at(2026, 11, 10), at(2026, 11, 11), at(2026, 11, 12), at(2026, 11, 3), at(2026, 11, 17), at(2026, 11, 17), at(2026, 11, 17)] }, NOW);
  const past = pastWeeks(weeks, "tasks_finished", 3);
  assert.equal(past.total, 8);
  assert.equal(past.reached, 1, "only the week of 9 Nov has three; this week's three do not count yet");
  assert.equal(past.marks.length, 8);
  assert.equal(past.marks[7], true);
  assert.equal(past.marks[6], false);
  assert.equal(pastWeeks(weeks, "tasks_finished", 1).reached, 2);
});

test("a week reads as Mon 16 – Sun 22 Nov, across a month and a year", () => {
  assert.equal(weekLabel(at(2026, 11, 16, 0)), "Mon 16 – Sun 22 Nov");
  assert.equal(weekLabel(at(2026, 11, 30, 0)), "Mon 30 Nov – Sun 6 Dec");
  assert.equal(weekLabel(at(2026, 12, 28, 0)), "Mon 28 Dec – Sun 3 Jan");
});

test("weeks follow the calendar through a clock change, in three time zones", () => {
  const before = process.env.TZ;
  try {
    for (const zone of ["Europe/Berlin", "America/New_York", "Australia/Sydney"]) {
      process.env.TZ = zone;
      // The Monday after each zone's change must open a new week, not belong to the one before.
      const cases: [Date, Date][] = [
        [new Date(2026, 9, 26, 0, 30), new Date(2026, 9, 25, 12)], // after the autumn change in the north (Berlin 25 Oct, New York 1 Nov)
        [new Date(2026, 10, 2, 0, 30), new Date(2026, 10, 1, 12)],
        [new Date(2026, 9, 5, 0, 30), new Date(2026, 9, 4, 12)], // Sydney moves forward 4 Oct
      ];
      for (const [monday, sunday] of cases) {
        const weeks = weeklyGoalCounts({ ...none, tasks: [monday, sunday] }, new Date(monday.getTime() + 3 * 86_400_000));
        const counts = weeks.map((w) => w.tasks_finished);
        assert.equal(counts.reduce((a, b) => a + b, 0), 2, `${zone}: both counted`);
        assert.equal(counts[counts.length - 1], 1, `${zone}: the Monday is this week`);
        assert.equal(counts[counts.length - 2], 1, `${zone}: the Sunday is the week before`);
      }
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("a long log stays fast", () => {
  const tasks = Array.from({ length: 100_000 }, (_, i) => new Date(NOW.getTime() - (i % 70) * 86_400_000));
  const t = performance.now();
  weeklyGoalCounts({ ...none, tasks }, NOW);
  assert.ok(performance.now() - t < 1500);
});

test("every measure has a name, a starting target that is a valid target, and only the two study ones need the recorder", () => {
  for (const measure of GOAL_MEASURES) {
    assert.ok(MEASURE_NAME[measure].length > 0);
    assert.ok(goalSchema.safeParse({ measure, target: DEFAULT_TARGET[measure] }).success, measure);
  }
  assert.deepEqual(GOAL_MEASURES.filter(needsRecorder), ["study_sessions", "study_minutes"]);
});
