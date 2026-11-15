import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntil, daysUntilLabel } from "@/lib/grades";
import { countdown, sessionProgress } from "@/lib/exam-readiness";

const at = (iso: string) => new Date(iso);

test("days until counts whole calendar days, and the label is built from the same number", () => {
  const now = new Date(2026, 10, 15, 14, 0);
  assert.equal(daysUntil(new Date(2026, 10, 15, 23, 59), now), 0);
  assert.equal(daysUntil(new Date(2026, 10, 16, 0, 5), now), 1);
  assert.equal(daysUntil(new Date(2026, 10, 20, 9, 0), now), 5);
  assert.equal(daysUntil(new Date(2026, 10, 14, 9, 0), now), 0, "a date in the past is today, never negative");
  assert.equal(daysUntilLabel(new Date(2026, 10, 20, 9, 0), now), "in 5 days");
  assert.equal(daysUntilLabel(new Date(2026, 10, 16, 9, 0), now), "tomorrow");
  assert.equal(daysUntilLabel(new Date(2026, 10, 15, 9, 0), now), "today");
  // A month boundary and a clock change do not make a day longer or shorter.
  assert.equal(daysUntil(new Date(2026, 11, 1, 9, 0), new Date(2026, 10, 28, 9, 0)), 3);
  assert.equal(daysUntil(new Date(2027, 2, 29, 9, 0), new Date(2027, 2, 27, 23, 0)), 2);
});

test("the countdown is a big figure and a small word, and says today and tomorrow in words", () => {
  assert.deepEqual(countdown(0), { big: "Today", small: "" });
  assert.deepEqual(countdown(1), { big: "Tomorrow", small: "" });
  assert.deepEqual(countdown(2), { big: "2", small: "days left" });
  assert.deepEqual(countdown(30), { big: "30", small: "days left" });
});

test("review sessions are counted done and total, and the next one is the earliest open one still ahead", () => {
  const now = at("2026-11-15T12:00:00Z");
  const sessions = [
    { status: "done", scheduledStart: at("2026-11-14T09:00:00Z"), estimatedMinutes: 60 },
    { status: "todo", scheduledStart: at("2026-11-18T10:00:00Z"), estimatedMinutes: 45 },
    { status: "in_progress", scheduledStart: at("2026-11-16T10:00:00Z"), estimatedMinutes: 90 },
    { status: "todo", scheduledStart: at("2026-11-13T10:00:00Z"), estimatedMinutes: 60 },
    { status: "todo", scheduledStart: null, estimatedMinutes: 60 },
  ];
  const result = sessionProgress(sessions, now);
  assert.equal(result.total, 5);
  assert.equal(result.done, 1);
  assert.deepEqual(result.next, { start: at("2026-11-16T10:00:00Z"), minutes: 90 });
  assert.equal(result.percent, 20);
});

test("with no sessions there is nothing next and nothing done; with every one done there is no next", () => {
  const now = at("2026-11-15T12:00:00Z");
  assert.deepEqual(sessionProgress([], now), { total: 0, done: 0, next: null, percent: 0 });
  const all = sessionProgress([{ status: "done", scheduledStart: at("2026-11-20T10:00:00Z"), estimatedMinutes: 60 }], now);
  assert.deepEqual(all, { total: 1, done: 1, next: null, percent: 100 });
});

test("a session starting right now still counts as ahead, and the percentage is rounded", () => {
  const now = at("2026-11-15T12:00:00Z");
  const result = sessionProgress(
    [
      { status: "todo", scheduledStart: now, estimatedMinutes: 30 },
      { status: "done", scheduledStart: null, estimatedMinutes: 30 },
      { status: "done", scheduledStart: null, estimatedMinutes: 30 },
    ],
    now,
  );
  assert.equal(result.next?.minutes, 30);
  assert.equal(result.percent, 67);
});
