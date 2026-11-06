import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcs } from "@/lib/ics";
import {
  FEED_WINDOW,
  feedItems,
  feedWindow,
  hashFeedToken,
  isFeedTokenShape,
  newFeedToken,
  renderFeed,
  tokenFromFile,
  type FeedEvent,
  type FeedTask,
} from "@/lib/calendar-feed";

const updated = new Date("2026-11-05T10:00:00Z");

const event = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  id: "e1",
  title: "Lecture",
  location: "Hall C",
  startTime: new Date("2026-11-10T09:00:00Z"),
  endTime: new Date("2026-11-10T10:00:00Z"),
  updatedAt: updated,
  ...over,
});
const task = (over: Partial<FeedTask> = {}): FeedTask => ({
  id: "t1",
  title: "Hand in report",
  dueDate: null,
  scheduledStart: null,
  scheduledEnd: null,
  estimatedMinutes: 60,
  updatedAt: updated,
  ...over,
});

/** Runs `fn` with the process in another time zone, then puts the old one back. */
function inZone<T>(zone: string, fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}
const lines = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);

// --- the token ----------------------------------------------------------------------------------

test("a token is 43 base64url characters, and a thousand of them are all different", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const token = newFeedToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    seen.add(token);
  }
  assert.equal(seen.size, 1000);
});

test("the stored form is a SHA-256 hex digest that does not contain the token and differs for near tokens", () => {
  const token = newFeedToken();
  const hash = hashFeedToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashFeedToken(token), "stable");
  assert.ok(!hash.includes(token) && !token.includes(hash));
  const near = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.notEqual(hashFeedToken(near), hash);
  // A known value, so a change of the hash function is seen.
  assert.equal(hashFeedToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("only a well-shaped token goes any further", () => {
  const token = newFeedToken();
  assert.equal(isFeedTokenShape(token), true);
  for (const bad of [token.slice(1), token + "A", token.slice(0, 42) + "+", token.slice(0, 42) + "/", token.slice(0, 42) + "=", token.slice(0, 20) + " " + token.slice(21), token.slice(0, 42) + "\n", token.slice(0, 42) + "ğ", "", "x".repeat(100_000)]) {
    assert.equal(isFeedTokenShape(bad), false, JSON.stringify(bad.slice(0, 50)));
  }
  const start = performance.now();
  isFeedTokenShape("A".repeat(1_000_000));
  assert.ok(performance.now() - start < 20);
});

test("the address names the token and a .ics suffix, exactly", () => {
  const token = newFeedToken();
  assert.equal(tokenFromFile(`${token}.ics`), token);
  for (const bad of [token, `${token}.ICS`, `${token}.ics.ics`, `${token}.ics?x=1`, `${token}.ics/`, `a/${token}.ics`, `${token.slice(1)}.ics`, ".ics", "", `${"A".repeat(100_000)}.ics`]) {
    assert.equal(tokenFromFile(bad), null, JSON.stringify(bad.slice(0, 60)));
  }
});

// --- the window ---------------------------------------------------------------------------------

test("the window is 30 days back and 365 ahead, with at most 2,000 of each kind", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const { from, to } = feedWindow(now);
  assert.equal(now.getTime() - from.getTime(), 30 * 86_400_000);
  assert.equal(to.getTime() - now.getTime(), 365 * 86_400_000);
  assert.deepEqual(FEED_WINDOW, { daysBack: 30, daysAhead: 365, maxItems: 2000 });
});

// --- events and tasks as calendar items ---------------------------------------------------------

test("an event is an opaque timed item with its place", () => {
  const [item] = feedItems([event()], []);
  assert.deepEqual(item, {
    uid: "event-e1@anamnesis",
    summary: "Lecture",
    location: "Hall C",
    start: new Date("2026-11-10T09:00:00Z"),
    end: new Date("2026-11-10T10:00:00Z"),
    stamp: updated,
  });
});

test("a task with a planned block is a timed free-time item, and the estimate ends a block with no end", () => {
  const [withEnd] = feedItems([], [task({ scheduledStart: new Date("2026-11-10T13:00:00Z"), scheduledEnd: new Date("2026-11-10T14:30:00Z") })]);
  assert.equal(withEnd.summary, "Task: Hand in report");
  assert.equal(withEnd.transparent, true);
  assert.equal(withEnd.category, "Task");
  assert.equal(withEnd.uid, "task-t1@anamnesis");
  assert.equal(withEnd.allDay, undefined);
  assert.equal(withEnd.end.toISOString(), "2026-11-10T14:30:00.000Z");
  const [noEnd] = feedItems([], [task({ scheduledStart: new Date("2026-11-10T13:00:00Z"), estimatedMinutes: 45 })]);
  assert.equal(noEnd.end.toISOString(), "2026-11-10T13:45:00.000Z");
});

test("a task with only a due date is an all-day item on that local day, ending the next", () => {
  inZone("Europe/Istanbul", () => {
    for (const due of [new Date(2026, 10, 12, 23, 59, 59, 999), new Date(2026, 10, 12, 0, 0, 0, 0), new Date(2026, 10, 12, 9, 0)]) {
      const [item] = feedItems([], [task({ dueDate: due })]);
      assert.equal(item.summary, "Due: Hand in report");
      assert.equal(item.allDay, true);
      assert.deepEqual([item.start.getFullYear(), item.start.getMonth(), item.start.getDate()], [2026, 10, 12], due.toString());
      assert.deepEqual([item.end.getFullYear(), item.end.getMonth(), item.end.getDate()], [2026, 10, 13]);
    }
  });
});

test("an all-day date holds across a daylight-saving change and at the end of a month and a year", () => {
  inZone("America/New_York", () => {
    // The clocks went back on 1 November 2026: that day has 25 hours.
    const ics = renderFeed([], [task({ dueDate: new Date(2026, 10, 1, 23, 59, 59, 999) }), task({ id: "t2", dueDate: new Date(2026, 2, 8, 23, 59, 0) }), task({ id: "t3", dueDate: new Date(2026, 11, 31, 23, 59, 0) }), task({ id: "t4", dueDate: new Date(2026, 0, 31, 12, 0) })]);
    const l = lines(ics);
    const pair = (uid: string) => {
      const at = l.indexOf(`UID:${uid}@anamnesis`);
      return [l[at + 3], l[at + 4]];
    };
    assert.deepEqual(pair("task-t1"), ["DTSTART;VALUE=DATE:20261101", "DTEND;VALUE=DATE:20261102"]);
    assert.deepEqual(pair("task-t2"), ["DTSTART;VALUE=DATE:20260308", "DTEND;VALUE=DATE:20260309"], "the day the clocks went forward");
    assert.deepEqual(pair("task-t3"), ["DTSTART;VALUE=DATE:20261231", "DTEND;VALUE=DATE:20270101"]);
    assert.deepEqual(pair("task-t4"), ["DTSTART;VALUE=DATE:20260131", "DTEND;VALUE=DATE:20260201"]);
  });
});

test("a task with a block and a due date is the block alone, a task with neither is nothing", () => {
  const both = feedItems([], [task({ dueDate: new Date(2026, 10, 12), scheduledStart: new Date("2026-11-10T13:00:00Z"), scheduledEnd: new Date("2026-11-10T14:00:00Z") })]);
  assert.equal(both.length, 1);
  assert.equal(both[0].allDay, undefined);
  assert.deepEqual(feedItems([], [task()]), []);
});

test("an event and a task with one id are two different calendar entries, and a block over midnight is one", () => {
  const items = feedItems([event({ id: "same" })], [task({ id: "same", scheduledStart: new Date("2026-11-10T22:00:00Z"), scheduledEnd: new Date("2026-11-11T01:00:00Z") })]);
  assert.equal(new Set(items.map((i) => i.uid)).size, 2);
  assert.equal(items.length, 2);
  assert.equal(items[1].start.toISOString(), "2026-11-10T22:00:00.000Z");
  assert.equal(items[1].end.toISOString(), "2026-11-11T01:00:00.000Z");
});

test("the stamp is when the row last changed, so two fetches of an unchanged account give the same calendar", () => {
  const first = renderFeed([event()], [task({ dueDate: new Date(2026, 10, 12) })]);
  const second = renderFeed([event()], [task({ dueDate: new Date(2026, 10, 12) })]);
  assert.equal(first, second);
});

test("a rendered feed reads back with our own reader", () => {
  const back = parseIcs(renderFeed([event({ title: "Calculus, week 3; B\\C" }), event({ id: "e2", startTime: new Date("2026-12-01T07:30:00Z"), endTime: new Date("2026-12-01T09:00:00Z"), location: null })], [task({ scheduledStart: new Date("2026-11-11T08:00:00Z"), scheduledEnd: new Date("2026-11-11T09:00:00Z") })]));
  assert.equal(back.length, 3);
  assert.equal(back[0].title, "Calculus, week 3; B\\C");
  assert.equal(back[0].location, "Hall C");
  assert.equal(back[2].title, "Task: Hand in report");
});

test("three thousand hostile titles render in well under a second, and none adds a line", () => {
  const evil = "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:x";
  const events = Array.from({ length: 3000 }, (_, i) => event({ id: `e${i}`, title: `${evil}${"ğ".repeat(500)}`, location: evil }));
  const start = performance.now();
  const ics = renderFeed(events, []);
  assert.ok(performance.now() - start < 600, `took ${(performance.now() - start).toFixed(0)} ms`);
  assert.equal(lines(ics).filter((l) => l === "BEGIN:VEVENT").length, 3000);
});
