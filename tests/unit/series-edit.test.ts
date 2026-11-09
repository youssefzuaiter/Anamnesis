import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEventChange,
  applyTaskChange,
  diffEvent,
  diffTask,
  isEmptyChange,
  parseScope,
  partialFailureMessage,
  sameEvent,
  sameTask,
  savedMessage,
  type EventFields,
  type TaskFields,
} from "@/lib/series-edit";

// Local wall-clock times throughout: a calendar day is a local day, and "time of day" is the wall clock.
const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m, 0, 0);
const hm = (date: Date) => `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const event = (start: Date, minutes = 90, extra: Partial<EventFields> = {}): EventFields => ({
  title: "ML lecture",
  description: "Bring the notes",
  location: "Hall C",
  projectId: null,
  startTime: start,
  endTime: new Date(start.getTime() + minutes * 60_000),
  ...extra,
});

const task = (extra: Partial<TaskFields> = {}): TaskFields => ({
  title: "Review notes",
  description: null,
  priority: "medium",
  tags: ["study"],
  estimatedMinutes: 60,
  projectId: null,
  courseId: null,
  goalId: null,
  ...extra,
});

test("an event that is not changed gives an empty change", () => {
  const before = event(at(2026, 11, 9, 9));
  assert.deepEqual(diffEvent(before, { ...before }), {});
  assert.ok(isEmptyChange(diffEvent(before, { ...before })));
});

test("each text field of an event is in the change on its own, and nothing else is", () => {
  const before = event(at(2026, 11, 9, 9));
  assert.deepEqual(diffEvent(before, { ...before, title: "ML lecture (guest)" }), { title: "ML lecture (guest)" });
  assert.deepEqual(diffEvent(before, { ...before, description: null }), { description: null });
  assert.deepEqual(diffEvent(before, { ...before, location: "Hall D" }), { location: "Hall D" });
  assert.deepEqual(diffEvent(before, { ...before, projectId: "p1" }), { projectId: "p1" });
});

test("a move to another day alone is not copied: dates stay with each occurrence", () => {
  const before = event(at(2026, 11, 9, 9));
  const after = event(at(2026, 11, 10, 9));
  assert.deepEqual(diffEvent(before, after), {});
});

test("a change of time of day carries the new start's minutes after midnight, and not the length", () => {
  const before = event(at(2026, 11, 9, 9), 90);
  const after = event(at(2026, 11, 9, 10, 30), 90);
  assert.deepEqual(diffEvent(before, after), { startMinutes: 10 * 60 + 30 });
});

test("a change of length carries the new length in milliseconds, and not the time", () => {
  const before = event(at(2026, 11, 9, 9), 60);
  const after = event(at(2026, 11, 9, 9), 120);
  assert.deepEqual(diffEvent(before, after), { durationMs: 120 * 60_000 });
});

test("time and length together, with the day moved as well, carry only the time and the length", () => {
  const before = event(at(2026, 11, 9, 9), 60);
  const after = event(at(2026, 11, 11, 10), 120);
  assert.deepEqual(diffEvent(before, after), { startMinutes: 600, durationMs: 120 * 60_000 });
});

test("a later occurrence keeps its own date and its own length when only the time moves", () => {
  const later = event(at(2026, 11, 23, 9), 45);
  const next = applyEventChange(later, { startMinutes: 14 * 60 });
  assert.equal(hm(next.startTime), "11/23 14:00");
  assert.equal(hm(next.endTime), "11/23 14:45", "its own 45 minutes, not the edited row's 90");
});

test("a length change keeps the later occurrence's own start", () => {
  const later = event(at(2026, 11, 23, 9), 45);
  const next = applyEventChange(later, { durationMs: 120 * 60_000 });
  assert.equal(hm(next.startTime), "11/23 09:00");
  assert.equal(hm(next.endTime), "11/23 11:00");
});

test("text changes are copied and the times are left alone", () => {
  const later = event(at(2026, 11, 23, 9), 45, { location: "Lab" });
  const next = applyEventChange(later, { title: "ML seminar", projectId: "p9" });
  assert.equal(next.title, "ML seminar");
  assert.equal(next.projectId, "p9");
  assert.equal(next.location, "Lab", "a field that was not changed keeps the later row's own value");
  assert.equal(next.startTime.getTime(), later.startTime.getTime());
  assert.equal(next.endTime.getTime(), later.endTime.getTime());
  assert.notEqual(next, later, "a new object: the row it was given is not changed in place");
  assert.equal(later.title, "ML lecture");
});

test("a description and a location are copied, a description can be cleared, and the other fields are left alone", () => {
  const later = event(at(2026, 11, 23, 9), 45, { title: "Own title", projectId: "p1" });
  const next = applyEventChange(later, { description: "Room changed", location: "Hall D" });
  assert.equal(next.description, "Room changed");
  assert.equal(next.location, "Hall D");
  assert.equal(next.title, "Own title");
  assert.equal(next.projectId, "p1");
  const cleared = applyEventChange(later, { description: null, location: null });
  assert.equal(cleared.description, null, "a change to nothing is a change");
  assert.equal(cleared.location, null);
});

test("an empty change gives an equal event", () => {
  const later = event(at(2026, 11, 23, 9));
  assert.ok(sameEvent(applyEventChange(later, {}), later));
});

test("on the days the clocks change a row gets the new wall-clock time on its own date", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    for (const [d, m, label] of [
      [29, 3, "29 March 2026, clocks forward"],
      [25, 10, "25 October 2026, clocks back"],
    ] as const) {
      const later = event(at(2026, m, d, 9), 90);
      const next = applyEventChange(later, { startMinutes: 10 * 60 });
      assert.equal(next.startTime.getDate(), d, label);
      assert.equal(next.startTime.getHours(), 10, label);
      assert.equal(next.startTime.getMinutes(), 0, label);
      assert.equal(next.endTime.getTime() - next.startTime.getTime(), 90 * 60_000, label);
    }
    // 01:30 does not exist on 29 March in London: the row stays on that date and does not throw.
    const gap = applyEventChange(event(at(2026, 3, 29, 9)), { startMinutes: 90 });
    assert.equal(gap.startTime.getDate(), 29);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("a task that is not changed gives an empty change, and each of the eight fields is in it on its own", () => {
  const before = task();
  assert.deepEqual(diffTask(before, { ...before }), {});
  assert.deepEqual(diffTask(before, { ...before, title: "Review the notes" }), { title: "Review the notes" });
  assert.deepEqual(diffTask(before, { ...before, description: "Chapters 3 and 4" }), { description: "Chapters 3 and 4" });
  assert.deepEqual(diffTask(before, { ...before, priority: "high" }), { priority: "high" });
  assert.deepEqual(diffTask(before, { ...before, tags: ["study", "ml"] }), { tags: ["study", "ml"] });
  assert.deepEqual(diffTask(before, { ...before, estimatedMinutes: 90 }), { estimatedMinutes: 90 });
  assert.deepEqual(diffTask(before, { ...before, projectId: "p1" }), { projectId: "p1" });
  assert.deepEqual(diffTask(before, { ...before, courseId: "c1" }), { courseId: "c1" });
  assert.deepEqual(diffTask(before, { ...before, goalId: "g1" }), { goalId: "g1" });
});

test("tags are compared element by element, in order", () => {
  const before = task({ tags: ["a", "b"] });
  assert.deepEqual(diffTask(before, { ...before, tags: ["a", "b"] }), {});
  assert.deepEqual(diffTask(before, { ...before, tags: ["b", "a"] }), { tags: ["b", "a"] });
  assert.deepEqual(diffTask(before, { ...before, tags: ["a"] }), { tags: ["a"] });
  assert.deepEqual(diffTask(before, { ...before, tags: [] }), { tags: [] });
});

test("applying a task change copies only the keys it has", () => {
  const later = task({ priority: "low", tags: ["own"], estimatedMinutes: 30 });
  const next = applyTaskChange(later, { title: "New title", priority: "high" });
  assert.equal(next.title, "New title");
  assert.equal(next.priority, "high");
  assert.deepEqual(next.tags, ["own"]);
  assert.equal(next.estimatedMinutes, 30);
  assert.ok(sameTask(applyTaskChange(later, {}), later));
  assert.ok(!sameTask(next, later));
  assert.equal(later.title, "Review notes", "the given row is not changed in place");
});

test("the message says what happened, from the server's count", () => {
  assert.equal(savedMessage(null), "Saved.");
  assert.equal(savedMessage({ changed: 1, scope: "this" }), "Saved.");
  assert.equal(savedMessage({ changed: 1, scope: "future" }), "Saved. No later occurrence needed changing (dates are not copied).");
  assert.equal(savedMessage({ changed: 2, scope: "future" }), "Saved. The same change was made to 1 later occurrence.");
  assert.equal(savedMessage({ changed: 3, scope: "future" }), "Saved. The same change was made to 2 later occurrences.");
  assert.equal(savedMessage({ changed: 52, scope: "future" }), "Saved. The same change was made to 51 later occurrences.");
});

test("applying a change to 5,000 rows takes a few milliseconds", () => {
  const rows = Array.from({ length: 5_000 }, (_, i) => event(at(2026, 11, 9 + (i % 20), 9)));
  const started = performance.now();
  for (const row of rows) applyEventChange(row, { title: "x", startMinutes: 600, durationMs: 3_600_000 });
  assert.ok(performance.now() - started < 200, "5,000 rows in under 200 ms");
});

test("two events or tasks that differ in any one field are not the same, and a change with a key is not empty", () => {
  const e = event(at(2026, 11, 9, 9));
  const events: EventFields[] = [
    { ...e, title: "x" },
    { ...e, description: "x" },
    { ...e, location: "x" },
    { ...e, projectId: "x" },
    { ...e, startTime: at(2026, 11, 9, 9, 1) },
    { ...e, endTime: at(2026, 11, 9, 11) },
  ];
  for (const other of events) assert.ok(!sameEvent(e, other));
  const t = task();
  const tasks: TaskFields[] = [
    { ...t, title: "x" },
    { ...t, description: "x" },
    { ...t, priority: "high" },
    { ...t, tags: [] },
    { ...t, estimatedMinutes: 1 },
    { ...t, projectId: "x" },
    { ...t, courseId: "x" },
    { ...t, goalId: "x" },
  ];
  for (const other of tasks) assert.ok(!sameTask(t, other));
  assert.equal(isEmptyChange({ title: "x" }), false);
  assert.equal(isEmptyChange({ description: null }), false, "a change to null is a change");
  assert.equal(isEmptyChange({}), true);
});

test("only exactly 'future' is the later occurrences; anything else a browser sends is only this one", () => {
  assert.equal(parseScope("future"), "future");
  assert.equal(parseScope("this"), "this");
  for (const hostile of [null, undefined, "", "FUTURE", "future ", " future", "all", "both", 1, true, ["future"], { toString: () => "future" }, "future\u0000"]) {
    assert.equal(parseScope(hostile), "this", `${JSON.stringify(hostile)} is not a request for the later occurrences`);
  }
});

test("an empty description or location is the same as none: an untouched field is not a change", () => {
  const stored = event(at(2026, 11, 9, 9), 90, { description: "", location: "" });
  const posted = { ...stored, description: null, location: null };
  assert.deepEqual(diffEvent(stored, posted), {}, "the form posts '' and the action makes it null");
  assert.ok(sameEvent(stored, posted));
  const filled = event(at(2026, 11, 9, 9));
  assert.deepEqual(diffEvent(filled, { ...filled, description: null }), { description: null }, "a real clearing is still a change");
  assert.deepEqual(diffEvent(filled, { ...filled, location: null }), { location: null });

  const t = task({ description: "" });
  assert.deepEqual(diffTask(t, { ...t, description: null }), {});
  assert.ok(sameTask(t, { ...t, description: null }));
  assert.deepEqual(diffTask(task({ description: "x" }), { ...t, description: null }), { description: null });
});

test("a failure part-way says what was already saved", () => {
  assert.equal(
    partialFailureMessage("The event must end after it starts.", 1),
    "The event must end after it starts. This occurrence was saved, but the later ones were not changed.",
  );
  assert.equal(
    partialFailureMessage("The event must end after it starts.", 2),
    "The event must end after it starts. This occurrence and 1 later occurrence were saved, but the rest were not.",
  );
  assert.equal(
    partialFailureMessage("Nope.", 5),
    "Nope. This occurrence and 4 later occurrences were saved, but the rest were not.",
  );
});
