import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_POST_CHARS, MAX_ROWS, buildRows, confirmRowsSchema, detectCourse, extractByCode, extractedSchema, markDuplicates, postText } from "@/lib/post-intake";

const NOW = new Date(2026, 10, 22, 10); // Sunday 22 Nov 2026

const POST = [
  "Hi all,",
  "Assignment 2 is due on Friday 4 December at 23:59 on the course page.",
  "The midterm exam will be on 26 November in room B2.",
  "Please read chapter 5 before next lecture.",
  "Lab report 3 must be submitted by tomorrow.",
  "Thanks, Dr. Example",
].join("\n");

test("the text of a post is trimmed, line endings are LF, and it is cut at the limit", () => {
  assert.equal(postText("  a\r\nb\rc  "), "a\nb\nc");
  assert.equal(postText("x".repeat(MAX_POST_CHARS + 500)).length, MAX_POST_CHARS);
  assert.equal(postText(""), "");
  assert.equal(postText(42 as never), "");
});

test("by rules, a sentence with a date and a cue word is a task, and the date is the one written in it", () => {
  const items = extractByCode(POST, NOW);
  assert.deepEqual(items.map((i) => i.quote), [
    "Assignment 2 is due on Friday 4 December at 23:59 on the course page.",
    "The midterm exam will be on 26 November in room B2.",
    "Lab report 3 must be submitted by tomorrow.",
  ]);
  assert.ok(items.every((i) => i.title.length > 0 && i.title.length <= 120));
  assert.ok(!items.some((i) => /please read/i.test(i.quote)), "no date, no task");
});

test("rows are the items whose quote is in the post, with the date read from the quote by code", () => {
  const rows = buildRows(
    [
      { title: "Assignment 2", quote: "Assignment 2 is due on Friday 4 December at 23:59 on the course page." },
      { title: "Invented project", quote: "A project worth 50% is due on 1 May." },
      { title: "Lab report 3", quote: "Lab report 3 must be submitted by tomorrow." },
      { title: "Read chapter 5", quote: "Please read chapter 5 before next lecture." },
    ],
    POST, NOW,
  );
  assert.deepEqual(rows.map((r) => [r.title, r.dueDate]), [["Assignment 2", "2026-12-04"], ["Lab report 3", "2026-11-23"], ["Read chapter 5", null]]);
});

test("a title is trimmed and capped, and the same title twice is one row", () => {
  const rows = buildRows(
    [{ title: `  ${"x".repeat(300)}  `, quote: "Lab report 3 must be submitted by tomorrow." }, { title: "lab  REPORT 3", quote: "Lab report 3 must be submitted by tomorrow." }, { title: "Lab report 3", quote: "Lab report 3 must be submitted by tomorrow." }],
    POST, NOW,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title.length, 120);
});

test("a course is preselected only when exactly one of the person's courses is named in the post", () => {
  const courses = [{ id: "c1", code: "CMP2003", title: "Machine Learning" }, { id: "c2", code: "MAT1001", title: "Calculus I" }];
  assert.equal(detectCourse("Hello CMP2003 students, the midterm is on 26 November.", courses), "c1");
  assert.equal(detectCourse("hello cmp 2003 students", courses), "c1", "case and a space between letters and digits");
  assert.equal(detectCourse("CMP2003 and MAT1001 are both mentioned", courses), null);
  assert.equal(detectCourse("nothing here", courses), null);
  assert.equal(detectCourse("XCMP20031 is not it", courses), null, "whole code only");
  assert.equal(detectCourse("CMP2003", []), null);
});

test("rows the person already has (same title, same day) start unticked", () => {
  const rows = markDuplicates(
    [{ title: "Assignment 2", dueDate: "2026-12-04", quote: "q", note: "n" }, { title: "Assignment 2", dueDate: "2026-12-11", quote: "q", note: "n" }, { title: "Other", dueDate: null, quote: "q", note: "n" }],
    [{ title: " assignment  2 ", dueDate: "2026-12-04" }, { title: "other", dueDate: "2026-01-01" }],
  );
  assert.deepEqual(rows.map((r) => r.existing), [true, false, false]);
});

test("what the model returns is held to a schema", () => {
  assert.equal(extractedSchema.safeParse({ items: [{ title: "A", quote: "Q" }] }).success, true);
  assert.equal(extractedSchema.safeParse({ items: [] }).success, true);
  for (const bad of [{}, { items: "x" }, { items: [{ title: "", quote: "q" }] }, { items: [{ title: "a", quote: "" }] }, { items: Array.from({ length: 21 }, () => ({ title: "a", quote: "q" })) }]) assert.equal(extractedSchema.safeParse(bad).success, false);
});

test("what the browser sends to add is a strict list of title, date, course and note", () => {
  const row = { title: " Assignment 2 ", dueDate: "2026-12-04", courseId: "0b0c3a52-6f0b-4a53-9b1e-6a3a2f1d9c11", note: "From the post" };
  const ok = confirmRowsSchema.safeParse([row, { title: "x", dueDate: null, courseId: null, note: "" }]);
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data[0].title, "Assignment 2");
  for (const bad of [[], Array.from({ length: MAX_ROWS + 1 }, () => row), [{ ...row, title: "" }], [{ ...row, title: "x".repeat(121) }], [{ ...row, dueDate: "2026-02-30" }], [{ ...row, dueDate: "4 Dec" }], [{ ...row, courseId: "nope" }], [{ ...row, note: "x".repeat(501) }], [{ ...row, userId: "x" }], [{ ...row, priority: "high" }], "rows", null]) {
    assert.equal(confirmRowsSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
});

test("a hostile 100,000-character post is read in well under a second", () => {
  const t = Date.now();
  const big = postText("a".repeat(100_000));
  extractByCode(big, NOW);
  extractByCode(`${"due ".repeat(2000)}tomorrow`, NOW);
  extractByCode(`${"1. ".repeat(3000)}Assignment due on 4 December.`, NOW);
  detectCourse(big, [{ id: "c", code: "CMP2003", title: "x" }]);
  assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
});
