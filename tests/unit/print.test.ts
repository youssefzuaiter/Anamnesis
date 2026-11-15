import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_NOTE_LIMIT, splitPrintable } from "@/lib/print";

test("a course within the limit prints whole, and says nothing was left out", () => {
  const { shown, leftOut } = splitPrintable([1, 2, 3]);
  assert.deepEqual(shown, [1, 2, 3]);
  assert.equal(leftOut, false);
});

test("exactly the limit is whole; one more is left out and the first ones are kept", () => {
  const whole = Array.from({ length: PRINT_NOTE_LIMIT }, (_, index) => index);
  assert.equal(splitPrintable(whole).leftOut, false);
  const over = [...whole, PRINT_NOTE_LIMIT];
  const { shown, leftOut } = splitPrintable(over);
  assert.equal(leftOut, true);
  assert.equal(shown.length, PRINT_NOTE_LIMIT);
  assert.equal(shown[0], 0);
  assert.equal(shown.at(-1), PRINT_NOTE_LIMIT - 1);
});

test("the limit is 100, the bound the page promises", () => {
  assert.equal(PRINT_NOTE_LIMIT, 100);
});
