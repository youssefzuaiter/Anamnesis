/**
 * The exam-prep planner against a real Postgres, DB-only like the rest of this
 * tier. What a pure test cannot check: another account never reaching an
 * assessment or being counted as busy, a second confirmation creating nothing,
 * and a time the browser invented creating nothing.
 *
 * Each test makes its own accounts so one test's tasks cannot leak into
 * another's plan.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { applyPrep, proposePrep } from "@/services/exam-prep-service";
import { createTask } from "@/services/task-service";

const NOW = new Date(2026, 9, 29, 15, 0); // Thu 29 Oct 2026, 15:00 local
const DUE = new Date(2026, 10, 10, 23, 59); // Tue 10 Nov 2026, end of day
/** A local time; `month` is a JavaScript month index, so 10 is November. */
const at = (month: number, day: number, hour = 9, minute = 0) =>
  new Date(2026, month, day, hour, minute);

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `prep-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

async function setup(userId: string, assessment: { dueDate?: Date | null; score?: number | null } = {}) {
  const course = await prisma.course.create({
    data: { userId, code: "CMP2003", title: "Machine Learning", term: "Fall 2026" },
  });
  const row = await prisma.assessment.create({
    data: {
      userId,
      courseId: course.id,
      title: "Midterm",
      weight: 30,
      maxScore: 100,
      dueDate: assessment.dueDate === undefined ? DUE : assessment.dueDate,
      score: assessment.score ?? null,
    },
  });
  return { course, assessment: row };
}

const request = (assessmentId: string, hours = 6, sessionMinutes = 60) => ({
  assessmentId,
  hours,
  sessionMinutes,
});

const refusedAs = (code: string) => (error: unknown) =>
  error instanceof AppError && error.code === code;

const fullDay = (userId: string, month: number, day: number) =>
  prisma.event.create({
    data: { userId, title: "Away", startTime: at(month, day, 9), endTime: at(month, day, 21) },
  });

test("a proposal for an empty calendar is six evenly spread sessions, with the notes and the cards due", async () => {
  const a = await newUser();
  const { course, assessment } = await setup(a.id);
  const older = await prisma.note.create({
    data: { userId: a.id, courseId: course.id, title: "Lecture 4", content: "x", tags: [], updatedAt: at(9, 20) },
  });
  await prisma.note.create({
    data: { userId: a.id, courseId: course.id, title: "Lecture 5", content: "x", tags: [], updatedAt: at(9, 25) },
  });
  await prisma.flashcard.createMany({
    data: [
      { userId: a.id, noteId: older.id, question: "q1", answer: "a", dueAt: at(9, 29, 12) },
      { userId: a.id, noteId: older.id, question: "q2", answer: "a", dueAt: at(9, 29, 12) },
      { userId: a.id, noteId: older.id, question: "q3", answer: "a", dueAt: at(10, 5) },
    ],
  });

  const proposal = await proposePrep(a.id, request(assessment.id), NOW);
  assert.deepEqual(
    proposal.sessions.map((s) => s.start.getTime()),
    [at(9, 30), at(10, 1), at(10, 3), at(10, 5), at(10, 7), at(10, 9)].map((d) => d.getTime()),
  );
  assert.deepEqual(proposal.sessions.map((s) => s.index), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(proposal.planned, { count: 0, minutes: 0 });
  assert.equal(proposal.requested, 6);
  assert.equal(proposal.total, 6);
  assert.equal(proposal.problem, "none");
  assert.equal(proposal.assessment.title, "Midterm");
  assert.equal(proposal.assessment.courseCode, "CMP2003");
  assert.deepEqual(proposal.notes.map((n) => n.title), ["Lecture 5", "Lecture 4"]);
  assert.equal(proposal.noteCount, 2);
  assert.equal(proposal.dueCards, 2);
});

test("another account cannot plan for an assessment, is never busy time, and cannot link a task to it", async () => {
  const a = await newUser();
  const b = await newUser();
  const { assessment } = await setup(a.id);
  await prisma.event.create({ data: { userId: b.id, title: "B's day", startTime: at(10, 3, 9), endTime: at(10, 3, 21) } });

  await assert.rejects(() => proposePrep(b.id, request(assessment.id), NOW), refusedAs("RESOURCE_NOT_FOUND"));
  const forA = await proposePrep(a.id, request(assessment.id), NOW);
  assert.ok(forA.sessions.some((s) => s.start.getTime() === at(10, 3).getTime()), "B's event moved A's plan");

  await assert.rejects(
    () =>
      createTask(b.id, {
        title: "x", description: null, priority: "medium", tags: [], dueDate: null, estimatedMinutes: 30,
        projectId: null, courseId: null, goalId: null, scheduledStart: null, scheduledEnd: null,
        assessmentId: assessment.id,
      }),
    refusedAs("RESOURCE_NOT_FOUND"),
  );
});

test("confirming makes ordinary, tagged, planned tasks that carry the course, the assessment and the notes", async () => {
  const a = await newUser();
  const { course, assessment } = await setup(a.id);
  await prisma.note.create({ data: { userId: a.id, courseId: course.id, title: "Lecture 4", content: "x", tags: [] } });

  const proposal = await proposePrep(a.id, request(assessment.id), NOW);
  const result = await applyPrep(a.id, request(assessment.id), proposal.sessions.map((s) => s.start.getTime()), NOW);
  assert.deepEqual(result, { added: 6, skipped: 0, courseId: course.id });

  const tasks = await prisma.task.findMany({ where: { userId: a.id }, orderBy: { scheduledStart: "asc" } });
  assert.equal(tasks.length, 6);
  tasks.forEach((task, i) => {
    assert.equal(task.title, `Review: Midterm (${i + 1} of 6)`);
    assert.equal(task.courseId, course.id);
    assert.equal(task.assessmentId, assessment.id);
    assert.deepEqual(task.tags, ["exam-prep"]);
    assert.equal(task.status, "todo");
    assert.equal(task.priority, "medium");
    assert.equal(task.estimatedMinutes, 60);
    assert.equal(task.scheduledStart?.getTime(), proposal.sessions[i].start.getTime());
    assert.equal(task.scheduledEnd?.getTime(), proposal.sessions[i].end.getTime());
    const endOfDay = new Date(proposal.sessions[i].start);
    endOfDay.setHours(23, 59, 59, 999);
    assert.equal(task.dueDate?.getTime(), endOfDay.getTime());
    assert.ok(task.description?.includes("Lecture 4"), task.description ?? "");
  });
});

test("only the ticked sessions are made, and they keep the numbers the person saw", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  const proposal = await proposePrep(a.id, request(assessment.id), NOW);
  const picked = [proposal.sessions[1], proposal.sessions[3]];

  const result = await applyPrep(a.id, request(assessment.id), picked.map((s) => s.start.getTime()), NOW);
  assert.equal(result.added, 2);
  const titles = (await prisma.task.findMany({ where: { userId: a.id }, orderBy: { scheduledStart: "asc" } })).map((t) => t.title);
  assert.deepEqual(titles, ["Review: Midterm (2 of 6)", "Review: Midterm (4 of 6)"]);
});

test("confirming twice makes the sessions once", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  const proposal = await proposePrep(a.id, request(assessment.id), NOW);
  const starts = proposal.sessions.map((s) => s.start.getTime());

  await applyPrep(a.id, request(assessment.id), starts, NOW);
  await assert.rejects(() => applyPrep(a.id, request(assessment.id), starts, NOW), refusedAs("VALIDATION_ERROR"));
  assert.equal(await prisma.task.count({ where: { userId: a.id } }), 6);
});

test("a time the server did not propose makes nothing", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  const invented = at(9, 31, 13).getTime();

  await assert.rejects(() => applyPrep(a.id, request(assessment.id), [invented], NOW), refusedAs("VALIDATION_ERROR"));
  assert.equal(await prisma.task.count({ where: { userId: a.id } }), 0);

  const proposal = await proposePrep(a.id, request(assessment.id), NOW);
  const mixed = await applyPrep(a.id, request(assessment.id), [proposal.sessions[0].start.getTime(), invented], NOW);
  assert.equal(mixed.added, 1);
  assert.equal(mixed.skipped, 1);
});

test("what is already planned reduces the request, deleted sessions do not count, and a full plan proposes nothing", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  const first = await proposePrep(a.id, request(assessment.id), NOW);
  const taken = first.sessions.slice(0, 2);
  await applyPrep(a.id, request(assessment.id), taken.map((s) => s.start.getTime()), NOW);

  const second = await proposePrep(a.id, request(assessment.id), NOW);
  assert.deepEqual(second.planned, { count: 2, minutes: 120 });
  assert.equal(second.requested, 4);
  assert.equal(second.total, 6);
  assert.deepEqual(second.sessions.map((s) => s.index), [3, 4, 5, 6]);
  for (const s of second.sessions) {
    for (const t of taken) assert.ok(s.end <= t.start || s.start >= t.end, "overlaps an existing session");
  }

  const one = await prisma.task.findFirstOrThrow({ where: { userId: a.id } });
  await prisma.task.update({ where: { id: one.id }, data: { deletedAt: new Date() } });
  const third = await proposePrep(a.id, request(assessment.id), NOW);
  assert.deepEqual(third.planned, { count: 1, minutes: 60 });
  assert.equal(third.requested, 5);

  const b = await newUser();
  const other = await setup(b.id);
  const all = await proposePrep(b.id, request(other.assessment.id), NOW);
  await applyPrep(b.id, request(other.assessment.id), all.sessions.map((s) => s.start.getTime()), NOW);
  const done = await proposePrep(b.id, request(other.assessment.id), NOW);
  assert.equal(done.problem, "fully-planned");
  assert.deepEqual(done.sessions, []);
  assert.equal(done.requested, 0);
});

test("a full calendar gives no sessions and no error; a partly full one gives fewer than asked", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  const window = [[9, 30], [9, 31], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [10, 9]] as const;
  for (const [m, d] of window) await fullDay(a.id, m, d);

  const none = await proposePrep(a.id, request(assessment.id), NOW);
  assert.equal(none.problem, "nothing-fits");
  assert.deepEqual(none.sessions, []);
  assert.equal(none.noGapDays.length, 11);

  await prisma.event.deleteMany({ where: { userId: a.id, startTime: { in: [at(10, 9), at(9, 30)] } } });
  const some = await proposePrep(a.id, request(assessment.id), NOW);
  assert.equal(some.problem, "none");
  assert.equal(some.sessions.length, 4);
  assert.equal(some.requested, 6);
  assert.equal(some.noGapDays.length, 9);
});

test("an assessment that cannot be planned for says why, and confirming it is refused", async () => {
  const a = await newUser();
  for (const bad of [{ score: 71 }, { dueDate: null }, { dueDate: at(9, 1, 23, 59) }]) {
    const { assessment } = await setup(a.id, bad);
    await assert.rejects(() => proposePrep(a.id, request(assessment.id), NOW), refusedAs("VALIDATION_ERROR"));
    await assert.rejects(() => applyPrep(a.id, request(assessment.id), [at(9, 30).getTime()], NOW), refusedAs("VALIDATION_ERROR"));
  }
  for (const dueDate of [at(9, 30, 23, 59), at(9, 29, 23, 59)]) {
    const { assessment } = await setup(a.id, { dueDate });
    const proposal = await proposePrep(a.id, request(assessment.id), NOW);
    assert.equal(proposal.problem, "no-window");
    assert.deepEqual(proposal.sessions, []);
    await assert.rejects(() => applyPrep(a.id, request(assessment.id), [at(9, 30).getTime()], NOW), refusedAs("VALIDATION_ERROR"));
  }
});

test("deleting the assessment keeps its sessions and clears the link", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  const proposal = await proposePrep(a.id, request(assessment.id), NOW);
  await applyPrep(a.id, request(assessment.id), proposal.sessions.map((s) => s.start.getTime()), NOW);

  await prisma.assessment.delete({ where: { id: assessment.id } });
  const tasks = await prisma.task.findMany({ where: { userId: a.id } });
  assert.equal(tasks.length, 6);
  assert.ok(tasks.every((t) => t.assessmentId === null));
});

test("a session never overlaps an event or a planned block", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  await prisma.event.create({ data: { userId: a.id, title: "Lab", startTime: at(10, 7, 9), endTime: at(10, 7, 11) } });
  await prisma.task.create({
    data: {
      userId: a.id, title: "Draft", status: "todo", priority: "medium", estimatedMinutes: 60, tags: [],
      scheduledStart: at(10, 7, 11), scheduledEnd: at(10, 7, 12),
    },
  });

  const proposal = await proposePrep(a.id, request(assessment.id), NOW);
  const seventh = proposal.sessions.find((s) => s.start.getMonth() === 10 && s.start.getDate() === 7);
  assert.ok(seventh, "no session on 7 Nov");
  assert.ok(seventh.start >= at(10, 7, 12), seventh.start.toISOString());
});

test("confirming after midnight makes only what still matches, and says how many were left out", async () => {
  const a = await newUser();
  const { assessment } = await setup(a.id);
  const shown = await proposePrep(a.id, request(assessment.id), NOW);
  const starts = shown.sessions.map((s) => s.start.getTime());
  const afterMidnight = at(9, 30, 0, 5); // 00:05 on 30 Oct: the panel was shown on the 29th

  const result = await applyPrep(a.id, request(assessment.id), starts, afterMidnight);
  assert.equal(result.added + result.skipped, 6);
  assert.ok(result.skipped >= 1, "the session for 30 Oct can no longer be placed");
  const made = await prisma.task.findMany({ where: { userId: a.id } });
  assert.equal(made.length, result.added);
  for (const task of made) {
    assert.ok(starts.includes(task.scheduledStart?.getTime() ?? -1), "a session the person was never shown");
  }
});
