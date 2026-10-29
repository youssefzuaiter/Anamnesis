import { test } from "node:test";
import assert from "node:assert/strict";
import { dayBounds } from "@/lib/day";

test("a day runs from local midnight to the next local midnight", () => {
  const { from, to } = dayBounds(new Date(2026, 9, 28, 18, 30, 15, 500));
  assert.deepEqual(from, new Date(2026, 9, 28, 0, 0, 0, 0));
  assert.deepEqual(to, new Date(2026, 9, 29, 0, 0, 0, 0));
});

test("the end of a month or a year is the first of the next", () => {
  assert.deepEqual(dayBounds(new Date(2026, 9, 31, 12)).to, new Date(2026, 10, 1));
  assert.deepEqual(dayBounds(new Date(2026, 11, 31, 12)).to, new Date(2027, 0, 1));
});

test("the day passed in is not changed, and each call returns fresh dates", () => {
  const day = new Date(2026, 9, 28, 18, 0);
  const before = day.getTime();
  const first = dayBounds(day);
  first.to.setHours(9, 0, 0, 0); // a caller may set the time on `to`
  assert.equal(day.getTime(), before);
  assert.deepEqual(dayBounds(day).to, new Date(2026, 9, 29));
});
