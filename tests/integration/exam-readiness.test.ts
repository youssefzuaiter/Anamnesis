/**
 * The readiness behind Today's "Next exam" card (ROADMAP item 38), against a real Postgres: only this assessment's live review
 * sessions, only this course's live cards that are due, the marks of this course, and nothing of another account.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getDashboard } from "@/services/dashboard-service";

const made: string[] = [];
async function newUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: `ready-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const NOW = new Date(2026, 10, 15, 12, 0);
const inDays = (days: number, hour = 9) => new Date(2026, 10, 15 + days, hour, 0);

async function course(userId: string, code = "CMP2003") {
  return prisma.course.create({ data: { userId, code, title: "Systems", term: "Fall" } });
}
const assessment = (userId: string, courseId: string, title: string, extra: Record<string, unknown> = {}) =>
  prisma.assessment.create({ data: { userId, courseId, title, weight: 30, maxScore: 100, ...extra } });
const session = (userId: string, assessmentId: string | null, extra: Record<string, unknown> = {}) =>
  prisma.task.create({ data: { userId, assessmentId, title: "Review", status: "todo", priority: "medium", tags: ["exam-prep"], estimatedMinutes: 60, ...extra } });
const card = async (userId: string, courseId: string | null, extra: { due?: Date; trashedNote?: boolean } = {}) => {
  const note = await prisma.note.create({ data: { userId, courseId, title: `N ${randomUUID()}`, content: "x", tags: [], deletedAt: extra.trashedNote ? new Date() : null } });
  return prisma.flashcard.create({ data: { userId, noteId: note.id, question: "Q", answer: "A", dueAt: extra.due ?? new Date(2026, 0, 1) } });
};

test("there is no readiness when there is no exam ahead", async () => {
  const me = await newUser();
  assert.equal((await getDashboard(me, NOW)).examReadiness, null);
  const c = await course(me);
  await assessment(me, c.id, "Past", { dueDate: inDays(-3) });
  await assessment(me, c.id, "Marked", { dueDate: inDays(3), score: 70 });
  assert.equal((await getDashboard(me, NOW)).examReadiness, null, "a past or already marked assessment is not an exam to prepare for");
});

test("the card counts this assessment's live sessions, this course's due cards and its marks", async () => {
  const me = await newUser();
  const c = await course(me);
  const other = await course(me, "OTHER1");
  await assessment(me, c.id, "Quiz 1", { dueDate: inDays(-10), score: 80, weight: 20 });
  const midterm = await assessment(me, c.id, "Midterm", { dueDate: inDays(5), weight: 30 });
  const later = await assessment(me, c.id, "Final", { dueDate: inDays(40), weight: 50 });

  await session(me, midterm.id, { status: "done", scheduledStart: inDays(-1, 10) });
  await session(me, midterm.id, { scheduledStart: inDays(1, 10), estimatedMinutes: 90 });
  await session(me, midterm.id, { scheduledStart: inDays(2, 10), estimatedMinutes: 45 });
  await session(me, midterm.id, { scheduledStart: inDays(3, 10), deletedAt: new Date() });
  await session(me, later.id, { scheduledStart: inDays(1, 8) });
  await session(me, null, { scheduledStart: inDays(1, 7) });

  await card(me, c.id);
  await card(me, c.id);
  await card(me, c.id, { due: inDays(2) });
  await card(me, c.id, { trashedNote: true });
  await card(me, other.id);
  await card(me, null);

  const dashboard = await getDashboard(me, NOW);
  const ready = dashboard.examReadiness!;
  assert.equal(ready.assessmentId, midterm.id);
  assert.equal(ready.courseId, c.id);
  assert.equal(ready.title, "Midterm");
  assert.equal(ready.code, "CMP2003");
  assert.equal(ready.days, 5);
  assert.deepEqual([ready.sessions.total, ready.sessions.done, ready.sessions.percent], [3, 1, 33]);
  assert.deepEqual(ready.sessions.next && [ready.sessions.next.start.getTime(), ready.sessions.next.minutes], [inDays(1, 10).getTime(), 90]);
  assert.equal(ready.cardsDue, 2, "only this course's live cards that are due");
  assert.equal(ready.average, 80, "the marks so far of this course");
  assert.equal(ready.bestPossible, 20 * 0.8 + 80, "what is banked plus everything still to come");
});

test("with nothing marked there is no average, and with no sessions there are none", async () => {
  const me = await newUser();
  const c = await course(me);
  await assessment(me, c.id, "Midterm", { dueDate: inDays(2) });
  const ready = (await getDashboard(me, NOW)).examReadiness!;
  assert.equal(ready.average, null);
  assert.equal(ready.bestPossible, 30);
  assert.deepEqual(ready.sessions, { total: 0, done: 0, next: null, percent: 0 });
  assert.equal(ready.cardsDue, 0);
});

test("another account's sessions, cards and marks are never counted, even when they name this assessment", async () => {
  const me = await newUser();
  const other = await newUser();
  const c = await course(me);
  const theirCourse = await course(other);
  const midterm = await assessment(me, c.id, "Midterm", { dueDate: inDays(4) });
  // Rows that belong to the other account but name my assessment and my course.
  await session(other, midterm.id, { status: "done" });
  await session(other, midterm.id);
  const note = await prisma.note.create({ data: { userId: other, courseId: c.id, title: "Theirs", content: "x", tags: [] } });
  await prisma.flashcard.create({ data: { userId: other, noteId: note.id, question: "Q", answer: "A", dueAt: new Date(2026, 0, 1) } });
  await prisma.assessment.create({ data: { userId: other, courseId: c.id, title: "Foreign mark", weight: 40, maxScore: 100, score: 100, dueDate: inDays(-2) } });
  await assessment(other, theirCourse.id, "Theirs", { dueDate: inDays(1) });

  const ready = (await getDashboard(me, NOW)).examReadiness!;
  assert.equal(ready.title, "Midterm", "another account's earlier exam is not mine");
  assert.equal(ready.sessions.total, 0);
  assert.equal(ready.cardsDue, 0);
  assert.equal(ready.average, null);
  assert.equal(ready.bestPossible, 30);
});

test("the marks reader leaves out a deleted course and another account's marks on its own", async () => {
  const { listMarks } = await import("@/repositories/course-repository");
  const me = await newUser();
  const other = await newUser();
  const live = await course(me);
  const gone = await prisma.course.create({ data: { userId: me, code: "GONE1", title: "Gone", term: "Fall", deletedAt: new Date() } });
  await assessment(me, live.id, "Mine", { score: 50 });
  await assessment(me, gone.id, "Of a deleted course", { score: 90 });
  await prisma.assessment.create({ data: { userId: other, courseId: live.id, title: "Foreign", weight: 10, maxScore: 100, score: 100 } });
  assert.deepEqual((await listMarks(me, live.id)).map((mark) => mark.score), [50]);
  assert.deepEqual(await listMarks(me, gone.id), []);
});
