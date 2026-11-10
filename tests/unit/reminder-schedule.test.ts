// The zone is set here, before any date is made: node:test runs each file in its own process, and Node
// re-reads TZ when it is assigned. November is GMT in London, so a UTC instant reads as the same local
// time, and the October clock change gives a real zone to get wrong.
process.env.TZ = "Europe/London";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFS,
  DIGEST_HOURS,
  LEAD_CHOICES,
  localDateKey,
  planReminders,
  type PushPrefs,
} from "@/lib/reminder-schedule";

const at = (iso: string) => new Date(iso);
const prefs = (over: Partial<PushPrefs> = {}): PushPrefs => ({ ...DEFAULT_PREFS, ...over });
const due = (...titles: string[]) => titles.map((title, i) => ({ id: `t${i}`, title }));
const plan = (now: string, input: Partial<Parameters<typeof planReminders>[0]> = {}) =>
  planReminders({ now: at(now), prefs: prefs(), dueToday: [], starting: [], ...input });

test("the zone this file needs is the one it runs in", () => {
  assert.equal(process.env.TZ, "Europe/London");
});

test("the defaults and the choices the settings offer", () => {
  assert.deepEqual(DEFAULT_PREFS, { leadMinutes: 15, digestHour: 8, showTitles: true });
  assert.deepEqual(LEAD_CHOICES, [5, 10, 15, 30, 60]);
  assert.deepEqual(DIGEST_HOURS, [6, 7, 8, 9, 10, 11, 12]);
});

test("the digest waits for its hour, then names what is due", () => {
  assert.deepEqual(plan("2026-11-10T07:59:59Z", { dueToday: due("A", "B", "C") }), []);
  assert.deepEqual(plan("2026-11-10T08:00:00Z", { dueToday: due("A", "B", "C") }), [
    { key: "digest:2026-11-10", title: "Due today", body: "A, B, C" },
  ]);
  assert.deepEqual(plan("2026-11-10T21:30:00Z", { dueToday: due("A") }).map((p) => p.key), ["digest:2026-11-10"], "still today: still sent");
  assert.deepEqual(plan("2026-11-10T06:00:00Z", { prefs: prefs({ digestHour: 6 }), dueToday: due("A") }).length, 1);
  assert.deepEqual(plan("2026-11-10T09:00:00Z"), [], "nothing due, no digest");
});

test("a long digest names five and counts the rest; hidden titles only count", () => {
  const seven = due("A", "B", "C", "D", "E", "F", "G");
  assert.equal(plan("2026-11-10T08:00:00Z", { dueToday: seven })[0].body, "A, B, C, D, E and 2 more");
  const hidden = prefs({ showTitles: false });
  assert.equal(plan("2026-11-10T08:00:00Z", { prefs: hidden, dueToday: seven })[0].body, "7 tasks due today");
  assert.equal(plan("2026-11-10T08:00:00Z", { prefs: hidden, dueToday: due("Secret") })[0].body, "1 task due today");
});

const soon = (kind: "event" | "task", id: string, startIso: string, title = `Title ${id}`) => ({ kind, id, title, start: at(startIso) });

test("a start inside the lead time is announced once with the minutes left", () => {
  const out = plan("2026-11-10T09:00:00Z", { starting: [soon("event", "e1", "2026-11-10T09:14:00Z", "Lecture")] });
  assert.deepEqual(out, [{ key: "event:e1:2026-11-10T09:14:00.000Z", title: "Starts in 14 min", body: "Lecture" }]);
  assert.equal(plan("2026-11-10T09:00:00Z", { starting: [soon("task", "k", "2026-11-10T09:00:30Z")] })[0].title, "Starts in 1 min");
});

test("the lead window includes its end, excludes what is past, and never announces late", () => {
  const starts = (iso: string) => plan("2026-11-10T09:00:00Z", { starting: [soon("event", "e", iso)] }).length;
  assert.equal(starts("2026-11-10T09:15:00.000Z"), 1, "exactly the lead ahead");
  assert.equal(starts("2026-11-10T09:15:00.001Z"), 0, "a millisecond further");
  assert.equal(starts("2026-11-10T09:00:00.000Z"), 0, "starting now is not ahead");
  assert.equal(starts("2026-11-10T08:50:00.000Z"), 0, "missed while asleep: never sent late");
  assert.equal(plan("2026-11-10T09:00:00Z", { prefs: prefs({ leadMinutes: 60 }), starting: [soon("event", "e", "2026-11-10T09:59:00Z")] }).length, 1);
});

test("a moved start is a new reminder; starts come in time order after the digest", () => {
  const first = plan("2026-11-10T09:00:00Z", { starting: [soon("task", "k", "2026-11-10T09:10:00Z")] })[0].key;
  const moved = plan("2026-11-10T09:00:00Z", { starting: [soon("task", "k", "2026-11-10T09:12:00Z")] })[0].key;
  assert.notEqual(first, moved);
  const out = plan("2026-11-10T09:00:00Z", {
    dueToday: due("A"),
    starting: [soon("event", "late", "2026-11-10T09:12:00Z"), soon("task", "early", "2026-11-10T09:05:00Z")],
  });
  assert.deepEqual(out.map((p) => p.key.split(":")[0] + ":" + p.key.split(":")[1]), ["digest:2026-11-10", "task:early", "event:late"]);
});

test("hidden titles say what kind of thing starts, never its name", () => {
  const out = plan("2026-11-10T09:00:00Z", {
    prefs: prefs({ showTitles: false }),
    starting: [soon("event", "e", "2026-11-10T09:05:00Z", "Therapy"), soon("task", "t", "2026-11-10T09:06:00Z", "Secret")],
  });
  assert.deepEqual(out.map((p) => p.body), ["An event", "A planned task"]);
  assert.ok(!JSON.stringify(out).includes("Therapy") && !JSON.stringify(out).includes("Secret"));
});

test("a title is one line and at most 120 characters", () => {
  const long = "x".repeat(300);
  const [p] = plan("2026-11-10T09:00:00Z", { starting: [soon("event", "e", "2026-11-10T09:05:00Z", `  ${long}\n`)] });
  assert.equal(p.body.length, 120);
  assert.ok(p.body.endsWith("…"));
  const [q] = plan("2026-11-10T09:00:00Z", { starting: [soon("event", "e", "2026-11-10T09:05:00Z", "Line one\r\nline\ttwo")] });
  assert.equal(q.body, "Line one line two");
});

test("the date of a reminder is the local date, also on the clock-change day", () => {
  assert.equal(localDateKey(at("2026-11-10T23:59:59Z")), "2026-11-10");
  // 25 October 2026: clocks go back at 02:00 BST. 23:30 UTC on the 24th is already 00:30 on the 25th in London.
  assert.equal(localDateKey(at("2026-10-24T23:30:00Z")), "2026-10-25");
  assert.equal(localDateKey(at("2026-10-25T00:30:00Z")), "2026-10-25");
  // After the change London is on GMT: 07:59 UTC is 07:59 local, 08:00 UTC is 08:00 local.
  assert.equal(plan("2026-10-25T07:59:00Z", { dueToday: due("A") }).length, 0);
  assert.deepEqual(plan("2026-10-25T08:00:00Z", { dueToday: due("A") }).map((p) => p.key), ["digest:2026-10-25"]);
  // Before the change (BST, UTC+1) 07:00 UTC is already 08:00 local.
  assert.deepEqual(plan("2026-10-24T07:00:00Z", { dueToday: due("A") }).map((p) => p.key), ["digest:2026-10-24"]);
});
