import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketOf } from "@/lib/task-bucket";

const NOW = new Date(2026, 9, 28, 18, 0); // Wed 28 Oct 2026, 18:00 local

test("a task with no due date is someday", () => {
  assert.equal(bucketOf({ dueDate: null }, NOW), "someday");
});

test("a task due at 09:00 is still today at 18:00, not overdue", () => {
  assert.equal(bucketOf({ dueDate: new Date(2026, 9, 28, 9, 0) }, NOW), "today");
});

test("the whole of today counts as today, from 00:00 to the last millisecond", () => {
  assert.equal(bucketOf({ dueDate: new Date(2026, 9, 28, 0, 0) }, NOW), "today");
  assert.equal(bucketOf({ dueDate: new Date(2026, 9, 28, 23, 59, 59, 999) }, NOW), "today");
});

test("midnight tomorrow is upcoming, and yesterday's last minute is overdue", () => {
  assert.equal(bucketOf({ dueDate: new Date(2026, 9, 29, 0, 0) }, NOW), "upcoming");
  assert.equal(bucketOf({ dueDate: new Date(2026, 9, 27, 23, 59) }, NOW), "overdue");
});
