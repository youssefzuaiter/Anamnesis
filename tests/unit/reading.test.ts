import { test } from "node:test";
import assert from "node:assert/strict";
import { READ_STATUSES, readStatusLabel, parseStatusParam, tidyTakeaway, readingSchema, countByStatus, MAX_TAKEAWAY } from "@/lib/reading";

test("a work is to read, reading or done, with a plain label each", () => {
  assert.deepEqual([...READ_STATUSES], ["to_read", "reading", "done"]);
  assert.deepEqual(READ_STATUSES.map(readStatusLabel), ["To read", "Reading", "Done"]);
});

test("the address names a status only when it is one plain string; anything else is all of them", () => {
  assert.equal(parseStatusParam("reading"), "reading");
  assert.equal(parseStatusParam("done"), "done");
  for (const bad of [undefined, "", "READING", "all", "reading ", ["reading"], ["reading", "done"], 1, null, "to-read", "__proto__"]) {
    assert.equal(parseStatusParam(bad), null, JSON.stringify(bad));
  }
});

test("a takeaway is one line: breaks and runs of spaces become single spaces, ends trimmed, empty is none", () => {
  assert.equal(tidyTakeaway("  Self-attention\r\nreplaces\n\nrecurrence.  "), "Self-attention replaces recurrence.");
  assert.equal(tidyTakeaway("a b c\tq"), "a b c q");
  assert.equal(tidyTakeaway("   \n  "), null);
  assert.equal(tidyTakeaway(""), null);
});

test("a takeaway is at most 200 characters once tidied, and the limit is exact", () => {
  assert.equal(MAX_TAKEAWAY, 200);
  const base = { status: "done" as const };
  assert.ok(readingSchema.safeParse({ ...base, takeaway: "x".repeat(200) }).success);
  assert.ok(!readingSchema.safeParse({ ...base, takeaway: "x".repeat(201) }).success);
  assert.ok(readingSchema.safeParse({ ...base, takeaway: `${"x ".repeat(100)}\n\n\n   ` }).success, "length is judged after tidying");
});

test("the schema takes exactly a status and a takeaway, as a real string or none", () => {
  assert.deepEqual(readingSchema.parse({ status: "reading", takeaway: "  hi  " }), { status: "reading", takeaway: "hi" });
  assert.deepEqual(readingSchema.parse({ status: "to_read", takeaway: "" }), { status: "to_read", takeaway: null });
  assert.deepEqual(readingSchema.parse({ status: "done", takeaway: null }), { status: "done", takeaway: null });
  assert.deepEqual(Object.keys(readingSchema.parse({ status: "done", takeaway: "a", userId: "x", key: "k", title: "t" })).sort(), ["status", "takeaway"]);
  for (const bad of [{ status: "finished", takeaway: "" }, { takeaway: "x" }, { status: "done", takeaway: 5 }, { status: "done", takeaway: {} }, { status: ["done"], takeaway: "" }, null, "done", [], { status: "DONE", takeaway: "" }]) {
    assert.ok(!readingSchema.safeParse(bad).success, JSON.stringify(bad));
  }
});

test("the counts per status always list all three, zero included", () => {
  assert.deepEqual(countByStatus(["done", "reading", "done", "to_read", "done"]), { to_read: 1, reading: 1, done: 3 });
  assert.deepEqual(countByStatus([]), { to_read: 0, reading: 0, done: 0 });
  assert.deepEqual(countByStatus(["done", "odd-value-from-an-older-release"]), { to_read: 0, reading: 0, done: 1 }, "an unknown stored value counts for nothing");
});

test("a 200,000-character takeaway is refused fast", () => {
  const t = performance.now();
  readingSchema.safeParse({ status: "done", takeaway: " \n".repeat(100_000) });
  readingSchema.safeParse({ status: "done", takeaway: "x".repeat(200_000) });
  assert.ok(performance.now() - t < 500);
});
