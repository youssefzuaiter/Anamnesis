import { test } from "node:test";
import assert from "node:assert/strict";
import { scanFences } from "@/lib/markdown-fences";

const scan = (text: string) => scanFences(text.split("\n"));

test("lines between fences, and the fence lines themselves, are inside", () => {
  const result = scan("a\n```js\nb\n```\nc");
  assert.deepEqual(result.inFence, [false, true, true, true, false]);
  assert.equal(result.open, null);
});

test("an unterminated fence runs to the end and reports its marker", () => {
  const result = scan("a\n````\nb\n```");
  assert.deepEqual(result.inFence, [false, true, true, true]);
  assert.equal(result.open, "````");
});

test("a closing fence must use the same character and be at least as long", () => {
  assert.equal(scan("```\n~~~\n``").open, "```");
  assert.equal(scan("~~~~\n~~~\n").open, "~~~~");
  assert.equal(scan("~~~\nx\n~~~~\n").open, null);
});

test("a closing fence carries no text after it", () => {
  assert.equal(scan("```\n``` not a close\n").open, "```");
});

test("an indent of up to three spaces still fences, four does not", () => {
  assert.equal(scan("   ```\nx\n").open, "```");
  assert.deepEqual(scan("    ```\nx\n").inFence, [false, false, false]);
});

test("a backtick run with backticks in its info string is inline code, not a fence", () => {
  assert.deepEqual(scan("``` `x` ```\ny").inFence, [false, false]);
});

test("a line ending in a carriage return still fences", () => {
  const result = scanFences(["```js\r", "x\r", "```\r"]);
  assert.deepEqual(result.inFence, [true, true, true]);
  assert.equal(result.open, null);
});

test("text with no fence has none open", () => {
  assert.deepEqual(scan("a\nb").inFence, [false, false]);
  assert.equal(scan("").open, null);
});
