/** Finding TODO lines in a note (ROADMAP item 33). Pure. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { todoTitles, MAX_TODO_TITLE } from "@/lib/todo-lines";

test("unchecked checkboxes and TODO: lines are found, with the text after the marker", () => {
  const note = ["Plan the week", "- [ ] Email Ada about the room", "- [x] Already done", "TODO: book the lab", "Not a task"].join("\n");
  assert.deepEqual(todoTitles(note), ["Email Ada about the room", "book the lab"]);
});

test("a done checkbox is never proposed, with either capital X", () => {
  assert.deepEqual(todoTitles("- [X] done\n- [x] also done\n- [ ] open"), ["open"]);
});

test("lines inside a fenced code block are not read", () => {
  const note = ["```md", "- [ ] inside code", "TODO: inside code", "```", "- [ ] outside"].join("\n");
  assert.deepEqual(todoTitles(note), ["outside"]);
});

test("the same title twice in one note is offered once", () => {
  assert.deepEqual(todoTitles("- [ ] Water the plants\nTODO: Water the plants\n- [ ]   water  the plants"), ["Water the plants"]);
});

test("an empty marker is not a task, and a long line is cut to the title limit", () => {
  assert.deepEqual(todoTitles("- [ ]\nTODO:   \n- [ ] " + "x".repeat(400)), ["x".repeat(MAX_TODO_TITLE)]);
  assert.equal(MAX_TODO_TITLE, 200);
});

test("TODO is read only as the marker with its colon, and not inside a word", () => {
  assert.deepEqual(todoTitles("MASTODON: not one\nTODOS: not one\nTODO: one"), ["one"]);
});

test("markup in a line is kept as text, not interpreted", () => {
  assert.deepEqual(todoTitles("- [ ] <img src=x onerror=alert(1)>"), ["<img src=x onerror=alert(1)>"]);
});

test("a hostile long note is read in linear time", () => {
  const note = Array.from({ length: 20_000 }, (_, i) => (i % 2 ? "- [ ] item " + i : "plain text")).join("\n");
  const started = performance.now();
  assert.equal(todoTitles(note).length, 10_000);
  assert.ok(performance.now() - started < 500);
});
