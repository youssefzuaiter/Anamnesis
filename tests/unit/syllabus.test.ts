import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ROWS, buildRows, confirmRowsSchema, endOfLocalDay, extractedSchema, markExisting, mergeRows, resolveDate, termYear, totalWeight, weightInQuote,
} from "@/lib/syllabus";

const NOW = new Date(2026, 10, 21, 12);

test("the term gives a year and says whether it is an autumn term", () => {
  assert.deepEqual(termYear("Fall 2026"), { year: 2026, autumn: true });
  assert.deepEqual(termYear("2026 Güz"), { year: 2026, autumn: true });
  assert.deepEqual(termYear("Autumn 2026"), { year: 2026, autumn: true });
  assert.deepEqual(termYear("Spring 2027"), { year: 2027, autumn: false });
  assert.equal(termYear("Semester two"), null);
  assert.equal(termYear("Fall 1999"), null, "a year outside 2000 to 2099 is not read");
});

test("a date is read only when it is a day and a month, and the year follows the term", () => {
  const fall = termYear("Fall 2026");
  assert.equal(resolveDate("Thursday 12 November", fall, NOW), "2026-11-12");
  assert.equal(resolveDate("due 4 December", fall, NOW), "2026-12-04");
  assert.equal(resolveDate("Dec 4", fall, NOW), "2026-12-04");
  assert.equal(resolveDate("December 4th, 2027", fall, NOW), "2027-12-04", "an explicit year wins");
  assert.equal(resolveDate("2026-11-30", fall, NOW), "2026-11-30");
  assert.equal(resolveDate("12 Jan", fall, NOW), "2027-01-12", "January to March of an autumn term is the next year");
  assert.equal(resolveDate("12 Jan", termYear("Spring 2027"), NOW), "2027-01-12");
  assert.equal(resolveDate("12 Nov", null, NOW), "2026-11-12", "no term year: this year");
});

test("anything that is not a calendar date is left blank", () => {
  const fall = termYear("Fall 2026");
  for (const text of [null, "", "week 7", "set by the registrar", "tomorrow", "next Friday", "31 February", "30 Feb 2026", "0 May", "32 May", "end of term", "12/11/2026", "x".repeat(10_000)]) {
    assert.equal(resolveDate(text, fall, NOW), null, String(text).slice(0, 20));
  }
});

test("a weight is kept only if its number is in the quoted line", () => {
  assert.equal(weightInQuote(30, "Midterm exam — 30% — Thursday 12 November"), 30);
  assert.equal(weightInQuote(30, "Midterm exam, weight: 30 points"), 30);
  assert.equal(weightInQuote(12.5, "Labs (12.5%)"), 12.5);
  assert.equal(weightInQuote(30, "Midterm exam on 12 November"), null);
  assert.equal(weightInQuote(3, "Midterm 30%"), null, "3 is not the 3 of 30");
  assert.equal(weightInQuote(30, "Midterm 130%"), null);
  assert.equal(weightInQuote(null, "Midterm 30%"), null);
  for (const bad of [-5, 101, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(weightInQuote(bad, `Exam ${bad}%`), null);
});

const SECTION = [
  "Grading",
  "Midterm exam — 30% — Thursday 12 November",
  "Course project, 20%, due 4 December",
  "Weekly quizzes (best 8 of 10) — 10%",
  "Final exam (40%), date set by the registrar",
].join("\n");

test("rows are the items whose quoted line is in the note, with checked weights and dates", () => {
  const rows = buildRows(
    [
      { title: "Midterm exam", weight: 30, quote: "Midterm exam — 30% — Thursday 12 November" },
      { title: "Quizzes", weight: 10, quote: "Weekly quizzes (best 8 of 10) — 10%" },
      { title: "Final exam", weight: 45, quote: "Final exam (40%), date set by the registrar" },
      { title: "Invented", weight: 50, quote: "Presentation worth 50% on 1 May" },
    ],
    SECTION, termYear("Fall 2026"), NOW,
  );
  assert.deepEqual(rows.map((r) => [r.title, r.weight, r.dueDate]), [["Midterm exam", 30, "2026-11-12"], ["Quizzes", 10, null], ["Final exam", null, null]]);
  // The date comes from the quoted line, so there is nothing for the model to invent: no field for it exists.
  const sneaky = buildRows([{ title: "Quizzes", weight: 10, quote: "Weekly quizzes (best 8 of 10) — 10%", dateText: "1 May" } as never], SECTION, termYear("Fall 2026"), NOW);
  assert.equal(sneaky[0].dueDate, null);
  assert.equal(rows[0].quote, "Midterm exam — 30% — Thursday 12 November");
});

test("a quote may differ in case, spacing and markdown, but a different line is not accepted", () => {
  const section = "| **Final exam** |  40 % |\n| Lab reports | 15% |";
  const ok = buildRows([{ title: "Final exam", weight: 40, quote: "final   exam | 40 %" }], section, null, NOW);
  assert.equal(ok.length, 1);
  const no = buildRows([{ title: "Homework", weight: 15, quote: "Homework sets total 15%" }], section, null, NOW);
  assert.equal(no.length, 0);
});

test("the same title twice is one row, and a proposal is at most 30 rows", () => {
  const rows = mergeRows([
    [{ title: "Midterm", weight: 30, dueDate: null, quote: "q1" }],
    [{ title: " midterm ", weight: 25, dueDate: "2026-11-12", quote: "q2" }, { title: "Final", weight: 40, dueDate: null, quote: "q3" }],
  ]);
  assert.deepEqual(rows.map((r) => [r.title, r.weight]), [["Midterm", 30], ["Final", 40]]);
  const many = mergeRows([Array.from({ length: 50 }, (_, i) => ({ title: `Item ${i}`, weight: 1, dueDate: null, quote: "q" }))]);
  assert.equal(many.length, MAX_ROWS);
});

test("rows matching an assessment the course already has start unticked", () => {
  const rows = markExisting([{ title: "Midterm exam", weight: 30, dueDate: null, quote: "q" }, { title: "Project", weight: 20, dueDate: null, quote: "q" }], ["  MIDTERM   exam "]);
  assert.deepEqual(rows.map((r) => [r.title, r.existing]), [["Midterm exam", true], ["Project", false]]);
});

test("the total counts only what is ticked and has a weight", () => {
  assert.equal(totalWeight([{ weight: 30, on: true }, { weight: 20, on: true }, { weight: 40, on: false }, { weight: null, on: true }]), 50);
  assert.equal(totalWeight([]), 0);
});

test("what the model returns is held to a schema", () => {
  const item = { title: "Midterm", weight: 30, quote: "Midterm 30%" };
  assert.equal(extractedSchema.safeParse({ items: [item] }).success, true);
  assert.equal(extractedSchema.safeParse({ items: [] }).success, true);
  for (const bad of [{}, { items: "x" }, { items: [{ ...item, title: "" }] }, { items: [{ ...item, title: "x".repeat(121) }] }, { items: [{ ...item, weight: "30" }] }, { items: [{ ...item, quote: "" }] }, { items: Array.from({ length: 21 }, () => item) }]) {
    assert.equal(extractedSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 50));
  }
});

test("what the browser sends to add is a strict list of name, weight and date", () => {
  const row = { title: " Midterm ", weight: 30, dueDate: "2026-11-12" };
  const parsed = confirmRowsSchema.safeParse([row, { title: "Quizzes", weight: 10, dueDate: null }]);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data[0].title, "Midterm");
  for (const bad of [[], Array.from({ length: 31 }, () => row), [{ ...row, title: "" }], [{ ...row, title: "x".repeat(121) }], [{ ...row, weight: -1 }], [{ ...row, weight: 101 }], [{ ...row, weight: null }], [{ ...row, weight: "30" }], [{ ...row, dueDate: "2026-02-30" }], [{ ...row, dueDate: "12 Nov" }], [{ ...row, userId: "x" }], [{ ...row, score: 100 }], "rows", null]) {
    assert.equal(confirmRowsSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
});

test("a due date is the end of that local day", () => {
  const d = endOfLocalDay("2026-11-12");
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 12, 23, 59]);
});

test("hostile 100,000-character input is read in well under a second", () => {
  const big = "a".repeat(100_000);
  const t = Date.now();
  resolveDate(big, termYear("Fall 2026"), NOW);
  resolveDate(`${"1 ".repeat(50_000)}Jan`, termYear("Fall 2026"), NOW);
  weightInQuote(30, `${"3".repeat(100_000)}%`);
  buildRows([{ title: "x", weight: 1, quote: big.slice(0, 300) }], big, null, NOW);
  assert.ok(Date.now() - t < 1000, `${Date.now() - t} ms`);
});
