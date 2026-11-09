import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RANGE,
  barPercent,
  buildCourseLines,
  foldByCourse,
  formatDuration,
  measuresShown,
  mergeRecent,
  parseRange,
  rangeHeading,
  rangeStart,
  sessionsLabel,
  totalsSentence,
  unsavedTimerSeconds,
  type Grouped,
  type RecentEntry,
} from "@/lib/study-time";

const MIN = 60;

test("only the three exact range strings are accepted; everything else is the default", () => {
  assert.equal(DEFAULT_RANGE, "28");
  for (const good of ["7", "28", "all"] as const) assert.equal(parseRange(good), good);
  for (const bad of [undefined, null, "", "abc", ["7", "28"], ["all"], 7, 28, "07", "ALL", " 7", "7 ", "28.0", {}]) {
    assert.equal(parseRange(bad), "28", JSON.stringify(bad));
  }
});

test("a window starts exactly N whole days before now, whatever the clock changes did", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  assert.equal(rangeStart("28", now)?.toISOString(), "2026-10-12T12:00:00.000Z");
  assert.equal(rangeStart("7", now)?.toISOString(), "2026-11-02T12:00:00.000Z");
  assert.equal(rangeStart("all", now), null);
  // Across the US and EU clock changes the arithmetic is still milliseconds, not wall-clock days.
  for (const iso of ["2026-03-30T12:00:00Z", "2026-11-02T12:00:00Z", "2026-10-26T00:30:00Z"]) {
    const at = new Date(iso);
    assert.equal(at.getTime() - rangeStart("28", at)!.getTime(), 28 * 24 * 60 * 60 * 1000, iso);
  }
  assert.notEqual(rangeStart("7", now), now, "a new date, never the caller's");
});

test("each range has a heading that says what it covers", () => {
  assert.equal(rangeHeading("28"), "last 28 days");
  assert.equal(rangeHeading("7"), "last 7 days");
  assert.equal(rangeHeading("all"), "all recorded");
});

test("durations are whole minutes, then hours and minutes", () => {
  assert.equal(formatDuration(0), "0 m");
  assert.equal(formatDuration(29), "0 m");
  assert.equal(formatDuration(30), "1 m", "half a minute rounds up");
  assert.equal(formatDuration(2400), "40 m");
  assert.equal(formatDuration(3540), "59 m");
  assert.equal(formatDuration(3570), "1 h", "59.5 minutes rounds to the hour");
  assert.equal(formatDuration(3600), "1 h");
  assert.equal(formatDuration(7200), "2 h");
  assert.equal(formatDuration(15000), "4 h 10 m");
  assert.equal(formatDuration(24000), "6 h 40 m");
  assert.equal(formatDuration(100 * 3600 + 5 * 60), "100 h 5 m");
  for (const bad of [-5, -1e9, NaN, Infinity, -Infinity]) assert.equal(formatDuration(bad), "0 m", String(bad));
});

test("counts are singular for one and plural otherwise", () => {
  assert.equal(sessionsLabel(1), "1 session");
  assert.equal(sessionsLabel(0), "0 sessions");
  assert.equal(sessionsLabel(2), "2 sessions");
  assert.equal(sessionsLabel(14), "14 sessions");
});

test("a course that is not live folds into no course, and equal keys add up", () => {
  const rows: Grouped[] = [
    { courseId: "live", seconds: 100, sessions: 2 },
    { courseId: "trashed", seconds: 50, sessions: 1 },
    { courseId: null, seconds: 25, sessions: 1 },
    { courseId: "live", seconds: 10, sessions: 1 },
  ];
  const folded = foldByCourse(rows, new Set(["live"]));
  assert.deepEqual(folded.get("live"), { seconds: 110, sessions: 3 });
  assert.deepEqual(folded.get(null), { seconds: 75, sessions: 2 });
  assert.equal(folded.size, 2);
  assert.equal(foldByCourse([], new Set()).size, 0);
});

const COURSES = [
  { id: "p", code: "PHYS 110", title: "Mechanics" },
  { id: "c", code: "CS 301", title: "Algorithms" },
  { id: "m", code: "MATH 201", title: "Linear Algebra" },
  { id: "e", code: "ENG 102", title: "Academic Writing" },
];

test("lines are by course code with no course last, and only courses that have time", () => {
  const writing: Grouped[] = [
    { courseId: "m", seconds: 155 * MIN, sessions: 8 },
    { courseId: null, seconds: 25 * MIN, sessions: 1 },
    { courseId: "c", seconds: 250 * MIN, sessions: 14 },
    { courseId: "e", seconds: 110 * MIN, sessions: 5 },
    { courseId: "p", seconds: 40 * MIN, sessions: 2 },
  ];
  const timer: Grouped[] = [
    { courseId: "p", seconds: 145 * MIN, sessions: 6 },
    { courseId: "c", seconds: 375 * MIN, sessions: 15 },
    { courseId: "e", seconds: 30 * MIN, sessions: 1 },
    { courseId: "m", seconds: 230 * MIN, sessions: 9 },
    { courseId: null, seconds: 20 * MIN, sessions: 1 },
  ];
  const { lines, scaleSeconds } = buildCourseLines(COURSES, writing, timer);
  assert.deepEqual(lines.map((l) => l.code), ["CS 301", "ENG 102", "MATH 201", "PHYS 110", null]);
  assert.equal(scaleSeconds, 22_500);
  const cs = lines[0];
  assert.deepEqual([cs.courseId, cs.title], ["c", "Algorithms"]);
  assert.deepEqual(cs.writing, { seconds: 250 * MIN, sessions: 14 });
  assert.deepEqual(cs.timer, { seconds: 375 * MIN, sessions: 15 });
  assert.deepEqual([lines[4].courseId, lines[4].title], [null, null]);
});

test("numbers inside a code are compared as numbers, equal codes by title", () => {
  const courses = [
    { id: "a", code: "CS 10", title: "B" },
    { id: "b", code: "CS 9", title: "Z" },
    { id: "c", code: "CS 9", title: "A" },
  ];
  const rows = (ids: string[]): Grouped[] => ids.map((id) => ({ courseId: id, seconds: 60, sessions: 1 }));
  const { lines } = buildCourseLines(courses, rows(["a", "b", "c"]), []);
  assert.deepEqual(lines.map((l) => l.title), ["A", "Z", "B"]);
});

test("a course with no time is left out, one with only timer time has an empty writing measure", () => {
  const { lines } = buildCourseLines(COURSES, [], [{ courseId: "c", seconds: 90, sessions: 1 }]);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].writing, { seconds: 0, sessions: 0 });
  assert.deepEqual(lines[0].timer, { seconds: 90, sessions: 1 });
  const none = buildCourseLines(COURSES, [], []);
  assert.deepEqual(none, { lines: [], scaleSeconds: 0 });
});

test("time recorded against a course that is not in the live list lands under no course", () => {
  const { lines, scaleSeconds } = buildCourseLines(
    COURSES,
    [{ courseId: "trashed", seconds: 600, sessions: 2 }, { courseId: null, seconds: 60, sessions: 1 }],
    [{ courseId: "gone", seconds: 300, sessions: 1 }],
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].courseId, null);
  assert.deepEqual(lines[0].writing, { seconds: 660, sessions: 3 });
  assert.deepEqual(lines[0].timer, { seconds: 300, sessions: 1 });
  assert.equal(scaleSeconds, 660);
});

test("a bar is a share of the largest value, never empty for real time and never past its track", () => {
  assert.equal(barPercent(250 * MIN, 375 * MIN), 66.7);
  assert.equal(barPercent(375 * MIN, 375 * MIN), 100);
  assert.equal(barPercent(30 * MIN, 375 * MIN), 8);
  assert.equal(barPercent(1, 375 * MIN), 2, "a sliver is still visible");
  assert.equal(barPercent(500, 100), 100, "beyond the scale stops at the track");
  for (const [seconds, scale] of [[10, 0], [10, -5], [10, NaN], [NaN, 100], [10, Infinity], [Infinity, 100], [0, 100], [-3, 100]]) {
    assert.equal(barPercent(seconds, scale), 0, `${seconds}/${scale}`);
  }
});

test("a measure shows when its switch is on or it has history", () => {
  const show = (writingOn: boolean, timerOn: boolean, writingSessions: number, timerSessions: number) =>
    measuresShown({ writingOn, timerOn, writingSessions, timerSessions });
  assert.deepEqual(show(false, false, 0, 0), { writing: false, timer: false });
  assert.deepEqual(show(false, false, 3, 0), { writing: true, timer: false });
  assert.deepEqual(show(false, false, 0, 2), { writing: false, timer: true });
  assert.deepEqual(show(true, false, 0, 0), { writing: true, timer: false });
  assert.deepEqual(show(false, true, 0, 0), { writing: false, timer: true });
  assert.deepEqual(show(true, true, 0, 0), { writing: true, timer: true });
});

const entry = (kind: "writing" | "timer", id: string, iso: string): RecentEntry => ({
  kind,
  id,
  at: new Date(iso),
  seconds: 600,
  courseId: null,
  wpm: kind === "writing" ? 30 : null,
  load: kind === "writing" ? "steady" : null,
});

test("recent sessions of both kinds are newest first, ties by id, cut to the count", () => {
  const writing = [entry("writing", "w1", "2026-11-09T09:00:00Z"), entry("writing", "w2", "2026-11-07T09:00:00Z")];
  const timer = [entry("timer", "t1", "2026-11-08T09:00:00Z"), entry("timer", "t2", "2026-11-09T09:00:00Z")];
  assert.deepEqual(mergeRecent(writing, timer, 10).map((e) => e.id), ["t2", "w1", "t1", "w2"]);
  assert.deepEqual(mergeRecent(writing, timer, 3).map((e) => e.id), ["t2", "w1", "t1"]);
  assert.deepEqual(
    mergeRecent([entry("writing", "b", "2026-11-09T09:00:00Z")], [entry("timer", "a", "2026-11-09T09:00:00Z")], 5).map((e) => e.id),
    ["a", "b"],
    "the same moment: by id, whichever list it came from",
  );
  assert.deepEqual(mergeRecent(writing, timer, 0), []);
  assert.deepEqual(mergeRecent(writing, timer, -1), []);
  assert.deepEqual(mergeRecent([], [], 5), []);
  assert.equal(writing.length, 2, "the inputs are not reordered or consumed");
  assert.deepEqual(writing.map((e) => e.id), ["w1", "w2"]);
});

test("unsaved timer seconds never count a second twice", () => {
  const left = (totalSeconds: number, remainingSeconds: number, savedSeconds: number) =>
    unsavedTimerSeconds({ totalSeconds, remainingSeconds, savedSeconds });
  assert.equal(left(1500, 1500, 0), 0, "not started");
  assert.equal(left(1500, 0, 0), 1500, "ran to the end");
  assert.equal(left(1500, 900, 0), 600, "paused partway");
  assert.equal(left(1500, 0, 1500), 0, "finished and already saved, then reset");
  assert.equal(left(1500, 600, 300), 600, "saved partway, ran on");
  assert.equal(left(1500, 2000, 0), 0, "remaining above the total is clamped");
  assert.equal(left(1500, -50, 0), 1500, "negative remaining is clamped to zero");
  assert.equal(left(1500, 0, 9999), 0, "saved more than ran gives zero, never negative");
  assert.equal(left(1500.4, 0.2, 0), 1500, "whole seconds");
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(left(bad, 0, 0), 0);
    assert.equal(left(1500, bad, 0), 0);
    assert.equal(left(1500, 0, bad), 0);
  }
  assert.equal(left(0, 0, 0), 0);
  assert.equal(left(-10, 0, 0), 0);
});

test("the totals sentence names each shown measure, never adds them, and says so only when there are two", () => {
  const writing = { seconds: 9 * 3600 + 40 * 60, sessions: 30 };
  const timer = { seconds: 13 * 3600 + 20 * 60, sessions: 32 };
  const both = { writing: true, timer: true };
  assert.equal(
    totalsSentence({ range: "28", shown: both, writing, timer }),
    "In these 28 days: writing 9 h 40 m across 30 sessions, timer 13 h 20 m across 32 sessions. They measure different things, so they are not added together.",
  );
  assert.ok(totalsSentence({ range: "7", shown: both, writing, timer }).startsWith("In these 7 days: writing"));
  assert.ok(totalsSentence({ range: "all", shown: both, writing, timer }).startsWith("Over everything recorded: writing"));
  assert.equal(
    totalsSentence({ range: "28", shown: { writing: true, timer: false }, writing, timer }),
    "In these 28 days: writing 9 h 40 m across 30 sessions.",
  );
  assert.equal(
    totalsSentence({ range: "28", shown: { writing: false, timer: true }, writing, timer: { seconds: 1800, sessions: 1 } }),
    "In these 28 days: timer 30 m across 1 session.",
  );
  assert.equal(totalsSentence({ range: "28", shown: { writing: false, timer: false }, writing, timer }), "");
});
