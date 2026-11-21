/**
 * Syllabus to assessments (ROADMAP item 50) against a real Postgres. The model is a scripted fake, so no test here reaches Ollama; what is checked
 * is everything around it: that the proposal is held to the note, that only the caller's own course and note are read, that nothing is written
 * until the person confirms, and that a confirmed add is all or none.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { addAssessments, proposeAssessments } from "@/services/syllabus-service";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `syl-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const SYLLABUS = [
  "# CMP2003 syllabus",
  "Grading",
  "Midterm exam — 30% — Thursday 12 November",
  "Course project, 20%, due 4 December",
  "Weekly quizzes (best 8 of 10) — 10%",
  "Final exam (40%), date set by the registrar",
].join("\n");
const NOW = new Date(2026, 10, 1);
const course = (userId: string, term = "Fall 2026") => prisma.course.create({ data: { userId, code: "CMP2003", title: "ML", term } });
const note = (userId: string, content = SYLLABUS, deleted = false) => prisma.note.create({ data: { userId, title: "Syllabus", content, deletedAt: deleted ? new Date() : null } });
const answer = {
  items: [
    { title: "Midterm exam", weight: 30, quote: "Midterm exam — 30% — Thursday 12 November" },
    { title: "Project", weight: 20, quote: "Course project, 20%, due 4 December" },
    { title: "Quizzes", weight: 10, quote: "Weekly quizzes (best 8 of 10) — 10%" },
    { title: "Final exam", weight: 40, quote: "Final exam (40%), date set by the registrar" },
    { title: "Participation", weight: 5, quote: "Participation counts for 5%" },
  ],
};
const scripted = (calls: { n: number }, value: unknown = answer) => async () => {
  calls.n += 1;
  return value;
};

test("a proposal is the rows the note backs up, with checked weights and dates, and nothing is written", async () => {
  const me = await newUser();
  const c = await course(me);
  const n = await note(me);
  const calls = { n: 0 };
  const p = await proposeAssessments(me, c.id, n.id, { complete: scripted(calls), now: NOW });
  assert.equal(calls.n, 1);
  assert.equal(p.noteTitle, "Syllabus");
  assert.deepEqual(p.rows.map((r) => [r.title, r.weight, r.dueDate, r.existing]), [
    ["Midterm exam", 30, "2026-11-12", false], ["Project", 20, "2026-12-04", false], ["Quizzes", 10, null, false], ["Final exam", 40, null, false],
  ], "the invented Participation row is not in the note, so it is dropped");
  assert.equal(await prisma.assessment.count({ where: { userId: me } }), 0);
});

test("rows the course already has are marked, and a weight the note does not show is dropped; the date is the note's, not the model's", async () => {
  const me = await newUser();
  const c = await course(me);
  await prisma.assessment.create({ data: { userId: me, courseId: c.id, title: "midterm EXAM", weight: 30 } });
  const n = await note(me);
  const odd = { items: [{ title: "Midterm exam", weight: 35, dateText: "1 May", quote: "Midterm exam — 30% — Thursday 12 November" }] };
  const p = await proposeAssessments(me, c.id, n.id, { complete: scripted({ n: 0 }, odd), now: NOW });
  assert.deepEqual(p.rows.map((r) => [r.title, r.weight, r.dueDate, r.existing]), [["Midterm exam", null, "2026-11-12", true]]);
});

test("another account's course or note, a trashed note and unknown ids are refused before the model is called", async () => {
  const me = await newUser();
  const them = await newUser();
  const mine = await course(me);
  const theirs = await course(them);
  const myNote = await note(me);
  const theirNote = await note(them);
  const trashed = await note(me, SYLLABUS, true);
  const calls = { n: 0 };
  for (const [courseId, noteId] of [[theirs.id, myNote.id], [mine.id, theirNote.id], [mine.id, trashed.id], [randomUUID(), myNote.id], [mine.id, randomUUID()]]) {
    await assert.rejects(proposeAssessments(me, courseId, noteId, { complete: scripted(calls) }), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  }
  assert.equal(calls.n, 0);
});

test("an empty note is refused; a section the model answers badly costs that section only; all of them bad is an error", async () => {
  const me = await newUser();
  const c = await course(me);
  await assert.rejects(proposeAssessments(me, c.id, (await note(me, "   ")).id, { complete: scripted({ n: 0 }) }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_ERROR");

  const long = Array.from({ length: 3 }, (_, i) => `${"filler line of text\n".repeat(220)}\nMidterm exam — 30% — Thursday 12 November`.replace("Midterm", i === 0 ? "Midterm" : `Midterm ${i}`)).join("\n\n");
  const longNote = await note(me, long);
  let call = 0;
  const flaky = async () => (++call === 1 ? { nonsense: true } : { items: [{ title: "Midterm 2", weight: 30, quote: "Midterm 2 exam — 30% — Thursday 12 November" }] });
  const p = await proposeAssessments(me, c.id, longNote.id, { complete: flaky, now: NOW });
  assert.ok(p.sections >= 2 && call === p.sections, "every section was read");
  assert.deepEqual(p.rows.map((r) => r.title), ["Midterm 2"]);

  await assert.rejects(proposeAssessments(me, c.id, longNote.id, { complete: async () => "garbage" }), (e: unknown) => e instanceof AppError && e.code === "AI_OUTPUT_INVALID");
  await assert.rejects(proposeAssessments(me, c.id, longNote.id, { complete: async () => { throw new AppError("AI_UNAVAILABLE", "off"); } }), (e: unknown) => e instanceof AppError && e.code === "AI_UNAVAILABLE");
});

test("a very long note is read in at most six sections", async () => {
  const me = await newUser();
  const c = await course(me);
  const huge = await note(me, `${"A line of the syllabus that says nothing about grades.\n\n".repeat(2000)}`);
  const calls = { n: 0 };
  const p = await proposeAssessments(me, c.id, huge.id, { complete: scripted(calls, { items: [] }), now: NOW });
  assert.equal(calls.n, 6);
  assert.deepEqual(p.rows, []);
});

test("adding writes the confirmed rows with their weights and end-of-day due dates, scores empty and out of 100", async () => {
  const me = await newUser();
  const c = await course(me);
  assert.deepEqual(await addAssessments(me, c.id, [{ title: "Midterm", weight: 30, dueDate: "2026-11-12" }, { title: "Quizzes", weight: 10, dueDate: null }]), { created: 2 });
  const rows = await prisma.assessment.findMany({ where: { userId: me }, orderBy: { title: "asc" } });
  assert.deepEqual(rows.map((r) => [r.title, r.weight, r.score, r.maxScore, r.courseId]), [["Midterm", 30, null, 100, c.id], ["Quizzes", 10, null, 100, c.id]]);
  const due = rows[0].dueDate!;
  assert.deepEqual([due.getFullYear(), due.getMonth(), due.getDate(), due.getHours(), due.getMinutes()], [2026, 10, 12, 23, 59]);
  assert.equal(rows[1].dueDate, null);
});

test("adding to another account's, a deleted or an unknown course writes nothing", async () => {
  const me = await newUser();
  const them = await newUser();
  const theirs = await course(them);
  const deleted = await prisma.course.create({ data: { userId: me, code: "DEL", title: "x", term: "Fall 2026", deletedAt: new Date() } });
  for (const id of [theirs.id, deleted.id, randomUUID()]) {
    await assert.rejects(addAssessments(me, id, [{ title: "Hijack", weight: 50, dueDate: null }]), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  }
  assert.equal(await prisma.assessment.count({ where: { userId: { in: [me, them] } } }), 0);
});
