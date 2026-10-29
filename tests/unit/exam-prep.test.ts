import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXAM_PREP_TAG,
  HORIZON_DAYS,
  MAX_SESSIONS,
  planExamPrep,
  prepAddedMessage,
  prepNotices,
  sessionDescription,
  sessionTitle,
  sessionsNeeded,
} from "@/lib/exam-prep";
import type { Busy } from "@/lib/day-planner";

const NOW = new Date(2026, 9, 29, 15, 0); // Thu 29 Oct 2026, 15:00 local
const DUE = new Date(2026, 10, 10, 23, 59); // Tue 10 Nov 2026, end of day

/** A local time; `month` is a JavaScript month index, so 10 is November. */
const at = (month: number, day: number, hour = 9, minute = 0) =>
  new Date(2026, month, day, hour, minute);

const plan = (over: Partial<Parameters<typeof planExamPrep>[0]> = {}) =>
  planExamPrep({ dueDate: DUE, now: NOW, sessions: 6, sessionMinutes: 60, busy: [], ...over });

const days = (sessions: { start: Date }[]) =>
  sessions.map((s) => `${s.start.getMonth()}-${s.start.getDate()}`);

test("the constants are the ones the design names", () => {
  assert.equal(EXAM_PREP_TAG, "exam-prep");
  assert.equal(HORIZON_DAYS, 21);
  assert.equal(MAX_SESSIONS, 40);
});

test("sessionsNeeded rounds up, subtracts what is planned, and stops at zero and at the cap", () => {
  assert.equal(sessionsNeeded(6, 60, 0), 6);
  assert.equal(sessionsNeeded(6, 90, 0), 4);
  assert.equal(sessionsNeeded(6, 60, 120), 4);
  assert.equal(sessionsNeeded(3, 60, 999), 0);
  assert.equal(sessionsNeeded(10, 45, 0), 14);
  assert.equal(sessionsNeeded(100, 45, 0), MAX_SESSIONS);
});

test("six sessions on an empty calendar are spread evenly back from the day before", () => {
  const result = plan();
  assert.deepEqual(
    result.sessions.map((s) => s.start.getTime()),
    [at(9, 30), at(10, 1), at(10, 3), at(10, 5), at(10, 7), at(10, 9)].map((d) => d.getTime()),
  );
  for (const s of result.sessions) assert.equal(s.end.getTime() - s.start.getTime(), 60 * 60_000);
  assert.equal(result.windowDays, 11);
  assert.deepEqual(result.noGapDays, []);
});

test("nothing is ever planned for today or for the due day", () => {
  const result = plan({ sessions: 12 });
  assert.equal(result.sessions.length, 12);
  assert.ok(!days(result.sessions).includes("9-29"), "today");
  assert.ok(!days(result.sessions).includes("10-10"), "the due day");
});

test("more sessions than days stack at most two a day, ten minutes apart", () => {
  const due = at(10, 2, 23, 59); // window: 30 Oct, 31 Oct, 1 Nov
  const six = planExamPrep({ dueDate: due, now: NOW, sessions: 6, sessionMinutes: 60, busy: [] });
  assert.deepEqual(
    six.sessions.map((s) => s.start.getTime()),
    [at(9, 30, 9), at(9, 30, 10, 10), at(9, 31, 9), at(9, 31, 10, 10), at(10, 1, 9), at(10, 1, 10, 10)].map((d) => d.getTime()),
  );
  const seven = planExamPrep({ dueDate: due, now: NOW, sessions: 7, sessionMinutes: 60, busy: [] });
  assert.equal(seven.sessions.length, 6);
});

test("a day with no gap long enough is skipped for the nearest free one and reported", () => {
  const busy: Busy[] = [{ start: at(10, 5, 9), end: at(10, 5, 21) }];
  const result = plan({ busy });
  assert.deepEqual(days(result.sessions), ["9-30", "10-1", "10-3", "10-6", "10-7", "10-9"]);
  assert.deepEqual(result.noGapDays, [new Date(2026, 10, 5)]);
});

test("busy time is respected, whether an event or a planned block", () => {
  const busy: Busy[] = [
    { start: at(10, 3, 9), end: at(10, 3, 11) },
    { start: at(10, 5, 10), end: at(10, 5, 12) },
    { start: at(10, 7, 13), end: at(10, 7, 15) },
    { start: at(10, 9, 9), end: at(10, 9, 9, 30) },
    { start: at(9, 31, 9), end: at(9, 31, 10) },
  ];
  const result = plan({ busy });
  assert.equal(result.sessions.length, 6);
  for (const s of result.sessions) {
    for (const b of busy) {
      assert.ok(s.end <= b.start || s.start >= b.end, `${s.start.toISOString()} overlaps a busy slot`);
    }
  }
  const third = result.sessions.find((s) => s.start.getDate() === 3 && s.start.getMonth() === 10);
  assert.equal(third?.start.getTime(), at(10, 3, 11).getTime());
});

test("every session sits inside 09:00 to 21:00 of its own day", () => {
  const result = plan({ sessions: 12, sessionMinutes: 90 });
  assert.ok(result.sessions.length > 0);
  for (const s of result.sessions) {
    const sameDay = s.start.toDateString() === s.end.toDateString();
    const dayEnd = new Date(s.start);
    dayEnd.setHours(21, 0, 0, 0);
    assert.ok(sameDay && s.start.getHours() >= 9 && s.end <= dayEnd);
  }
});

test("no window: due tomorrow, today, or in the past plans nothing", () => {
  for (const dueDate of [at(9, 30, 23, 59), at(9, 29, 23, 59), at(9, 1, 23, 59)]) {
    const result = plan({ dueDate });
    assert.deepEqual(result.sessions, []);
    assert.equal(result.windowDays, 0);
  }
});

test("the window reaches back at most 21 days", () => {
  const due = new Date(2027, 2, 1, 23, 59);
  const result = plan({ dueDate: due, sessions: 10 });
  assert.equal(result.windowDays, HORIZON_DAYS);
  assert.equal(result.sessions.length, 10);
  const earliest = new Date(2027, 1, 8);
  const examDay = new Date(2027, 2, 1);
  for (const s of result.sessions) assert.ok(s.start >= earliest && s.start < examDay);
});

test("the days are walked correctly across a year end", () => {
  const result = planExamPrep({
    dueDate: new Date(2027, 0, 2, 23, 59),
    now: new Date(2026, 11, 28, 10, 0),
    sessions: 4,
    sessionMinutes: 60,
    busy: [],
  });
  assert.equal(result.windowDays, 4);
  assert.deepEqual(
    result.sessions.map((s) => `${s.start.getFullYear()}-${s.start.getMonth()}-${s.start.getDate()}`),
    ["2026-11-29", "2026-11-30", "2026-11-31", "2027-0-1"],
  );
});

test("the same input gives the same plan and the busy list is left alone", () => {
  const busy: Busy[] = Object.freeze([{ start: at(10, 3, 9), end: at(10, 3, 11) }]) as Busy[];
  const before = JSON.stringify(busy);
  const first = plan({ busy });
  const second = plan({ busy });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(busy), before);
});

test("the session title numbers the sessions and keeps long names short", () => {
  assert.equal(sessionTitle("Midterm", 2, 6), "Review: Midterm (2 of 6)");
  const long = sessionTitle("x".repeat(300), 2, 6);
  assert.ok(long.startsWith(`Review: ${"x".repeat(150)} (`));
  assert.ok(long.length < 200);
});

test("the session description names the notes and the cards", () => {
  const base = { assessment: "Midterm", courseCode: "CMP2003", dueDate: DUE, notes: ["Lecture 4", "Lecture 5", "Lecture 6"], noteCount: 3, dueCards: 14 };
  assert.equal(
    sessionDescription(base),
    [
      "Review session for Midterm (CMP2003), Tue 10 Nov.",
      "Notes to go through: Lecture 4, Lecture 5, Lecture 6.",
      "Start with the flashcards due for this course: 14.",
    ].join("\n"),
  );
  assert.ok(sessionDescription({ ...base, noteCount: 5 }).includes("Lecture 6 and 2 more."));
  const empty = sessionDescription({ ...base, notes: [], noteCount: 0, dueCards: 0 });
  assert.ok(empty.includes("No notes in this course yet."));
  assert.ok(empty.includes("No flashcards are due right now."));
});

const notice = (over: Partial<Parameters<typeof prepNotices>[0]> = {}) =>
  prepNotices({
    problem: "none",
    title: "Midterm",
    dueLabel: "Tue 10 Nov",
    sessionMinutes: 60,
    plannedCount: 0,
    plannedHours: 0,
    placed: 6,
    requested: 6,
    windowDays: 11,
    noGapLabels: [],
    ...over,
  });

test("a plan that fits has nothing to say", () => {
  assert.deepEqual(notice(), { message: null, shortfall: null });
});

test("an empty proposal says why", () => {
  assert.equal(
    notice({ problem: "fully-planned", plannedCount: 4, plannedHours: 4, placed: 0, requested: 0 }).message,
    "That is already planned: 4 sessions (4 h) are on your calendar for Midterm.",
  );
  assert.equal(
    notice({ problem: "no-window", placed: 0, windowDays: 0 }).message,
    "There is no whole day between tomorrow and Tue 10 Nov to plan into.",
  );
  assert.equal(
    notice({ problem: "nothing-fits", placed: 0 }).message,
    "No session of 60 min fits before Tue 10 Nov. Try 45-minute sessions, or free up some time and propose again.",
  );
  assert.equal(
    notice({ problem: "nothing-fits", placed: 0, sessionMinutes: 45 }).message,
    "No session of 45 min fits before Tue 10 Nov. Free up some time and propose again.",
  );
});

test("a short plan says how many fit and names the days with no gap", () => {
  const short = { placed: 3, requested: 4 };
  assert.equal(
    notice({ ...short, noGapLabels: ["Sun 8 Nov"] }).shortfall,
    "Only 3 of 4 sessions fit before Tue 10 Nov. There is no free gap of 60 min on Sun 8 Nov. Try 45-minute sessions, or free up some time and propose again.",
  );
  assert.ok(notice({ ...short, noGapLabels: ["Sat 7 Nov", "Sun 8 Nov"] }).shortfall?.includes("on Sat 7 Nov and Sun 8 Nov."));
  assert.ok(notice({ ...short, noGapLabels: ["Fri 6 Nov", "Sat 7 Nov", "Sun 8 Nov"] }).shortfall?.includes("on Fri 6 Nov, Sat 7 Nov and Sun 8 Nov."));
  assert.ok(notice({ ...short, windowDays: 9, noGapLabels: ["a", "b", "c", "d"] }).shortfall?.includes("on 4 of the 9 days."));
  assert.equal(
    notice({ ...short, sessionMinutes: 45 }).shortfall,
    "Only 3 of 4 sessions fit before Tue 10 Nov. Free up some time and propose again.",
  );
});

test("the confirmation says how many were added, and when some ticked sessions no longer fit", () => {
  assert.equal(
    prepAddedMessage(5, 0),
    "Added 5 sessions to your calendar. Each one shows on its own day, on Today and in the calendar.",
  );
  assert.equal(
    prepAddedMessage(1, 0),
    "Added 1 session to your calendar. It shows on its own day, on Today and in the calendar.",
  );
  assert.equal(
    prepAddedMessage(3, 3),
    "Added 3 of the 6 sessions you ticked: the other 3 no longer fit. Propose a plan again to see what is left.",
  );
  assert.equal(
    prepAddedMessage(1, 2),
    "Added 1 of the 3 sessions you ticked: the other 2 no longer fit. Propose a plan again to see what is left.",
  );
});
