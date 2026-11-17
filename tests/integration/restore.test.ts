/**
 * Restoring from a JSON export (ROADMAP item 35), against a real Postgres and the real export: an account is
 * filled, exported with `buildFullExport`, and restored into another. The file is hostile data, so most of
 * these tests are about what must NOT happen: another account's rows touched, an id kept, a link attached
 * to something that is not the caller's, a second run adding anything.
 *
 * Ollama may be off: saving a note then logs a warning and carries on, which nothing below depends on.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildFullExport } from "@/services/export-service";
import { runJsonRestore, type RestoreReport } from "@/services/restore-service";
import { RESTORE_KINDS, RESTORE_LIMITS } from "@/lib/restore";

const made: string[] = [];
async function newUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: `restore-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
async function restore(userId: string, file: unknown, apply: boolean): Promise<RestoreReport> {
  const outcome = await runJsonRestore(userId, bytes(file), { apply });
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
  return outcome.report;
}
const created = (report: RestoreReport) => RESTORE_KINDS.reduce((sum, kind) => sum + report.kinds[kind].created, 0);
const wouldCreate = (report: RestoreReport) => RESTORE_KINDS.reduce((sum, kind) => sum + report.kinds[kind].create, 0);

const counts = async (userId: string) => ({
  courses: await prisma.course.count({ where: { userId } }),
  assessments: await prisma.assessment.count({ where: { userId } }),
  goals: await prisma.goal.count({ where: { userId } }),
  projects: await prisma.project.count({ where: { userId } }),
  notes: await prisma.note.count({ where: { userId } }),
  tasks: await prisma.task.count({ where: { userId } }),
  steps: await prisma.taskChecklistItem.count({ where: { userId } }),
  events: await prisma.event.count({ where: { userId } }),
  references: await prisma.reference.count({ where: { userId } }),
  cards: await prisma.flashcard.count({ where: { userId } }),
});

/** An account with one of everything, linked the way the app links them. */
async function fill(userId: string) {
  const course = await prisma.course.create({ data: { userId, code: "CMP1", title: "Calculus", term: "Fall 2026", credits: 4, finalGrade: "BA" } });
  const assessment = await prisma.assessment.create({ data: { userId, courseId: course.id, title: "Midterm", weight: 30, score: 71, maxScore: 100, dueDate: new Date("2026-11-20T09:00:00Z") } });
  const goal = await prisma.goal.create({ data: { userId, title: "Graduate", category: "University" } });
  const project = await prisma.project.create({ data: { userId, goalId: goal.id, title: "Thesis", category: "University" } });
  const note = await prisma.note.create({ data: { userId, courseId: course.id, projectId: project.id, title: "Lecture: limits", content: "A limit.\r\n\r\nSee [[Derivatives]].", tags: ["calc"], isFavorite: true } });
  await prisma.note.create({ data: { userId, title: "Derivatives", content: "Slopes.", tags: [] } });
  const recurrenceId = randomUUID();
  const task = await prisma.task.create({
    data: { userId, projectId: project.id, courseId: course.id, noteId: note.id, goalId: goal.id, assessmentId: assessment.id, title: "Revise limits", status: "done", priority: "high", tags: ["exam"], dueDate: new Date("2026-11-18T20:59:59Z"), estimatedMinutes: 90, completedAt: new Date("2026-11-17T10:00:00Z"), recurrenceId },
  });
  await prisma.task.create({ data: { userId, projectId: project.id, goalId: goal.id, title: "Revise limits again", recurrenceId, dueDate: new Date("2026-11-25T20:59:59Z"), status: "todo", priority: "medium", tags: [] } });
  await prisma.taskChecklistItem.createMany({ data: [{ userId, taskId: task.id, title: "Read", done: true, position: 0 }, { userId, taskId: task.id, title: "Practise", done: false, position: 1 }] });
  await prisma.event.create({ data: { userId, courseId: course.id, projectId: project.id, title: "Midterm", startTime: new Date("2026-11-20T09:00:00Z"), endTime: new Date("2026-11-20T11:00:00Z"), location: "Hall C" } });
  await prisma.reference.create({ data: { userId, key: "knuth1997", type: "book", title: "The Art of Computer Programming", authors: [{ family: "Knuth", given: "Donald" }], year: 1997, details: { publisher: "Addison-Wesley" } } });
  await prisma.flashcard.create({ data: { userId, noteId: note.id, question: "A limit is?", answer: "A value approached.", easeFactor: 2.1, intervalDays: 6, repetitions: 2, dueAt: new Date("2026-12-01T00:00:00Z") } });
  return { course, assessment, goal, project, note, task };
}

const exportOf = async (userId: string) => JSON.parse(JSON.stringify(await buildFullExport(userId)));

test("a round trip into another account restores everything, linked to the new account's own rows", async () => {
  const a = await newUser();
  const b = await newUser();
  const original = await fill(a);
  const file = await exportOf(a);

  const preview = await restore(b, file, false);
  assert.deepEqual(await counts(b), { courses: 0, assessments: 0, goals: 0, projects: 0, notes: 0, tasks: 0, steps: 0, events: 0, references: 0, cards: 0 }, "a preview writes nothing");
  assert.ok(wouldCreate(preview) > 0);

  const report = await restore(b, file, true);
  assert.equal(created(report), wouldCreate(preview), "apply does what the preview said");
  assert.deepEqual(await counts(b), { courses: 1, assessments: 1, goals: 1, projects: 1, notes: 2, tasks: 2, steps: 2, events: 1, references: 1, cards: 1 });

  const course = await prisma.course.findFirstOrThrow({ where: { userId: b } });
  const project = await prisma.project.findFirstOrThrow({ where: { userId: b } });
  const goal = await prisma.goal.findFirstOrThrow({ where: { userId: b } });
  const assessment = await prisma.assessment.findFirstOrThrow({ where: { userId: b } });
  const note = await prisma.note.findFirstOrThrow({ where: { userId: b, title: "Lecture: limits" } });
  const task = await prisma.task.findFirstOrThrow({ where: { userId: b, title: "Revise limits" } });
  // Fresh ids everywhere: nothing of account A's identity came across.
  for (const [mine, theirs] of [[course.id, original.course.id], [project.id, original.project.id], [goal.id, original.goal.id], [assessment.id, original.assessment.id], [note.id, original.note.id], [task.id, original.task.id]]) {
    assert.notEqual(mine, theirs);
  }
  assert.equal(note.courseId, course.id);
  assert.equal(note.projectId, project.id);
  assert.equal(note.content, "A limit.\n\nSee [[Derivatives]].");
  assert.deepEqual(note.tags, ["calc"]);
  assert.equal(note.isFavorite, true);
  assert.deepEqual([task.projectId, task.courseId, task.goalId, task.noteId, task.assessmentId], [project.id, course.id, goal.id, note.id, assessment.id]);
  assert.equal(task.status, "done");
  assert.ok(task.completedAt, "a done task has a completion time");
  assert.equal(project.goalId, goal.id);
  assert.equal(project.progress, 50, "progress is worked out here: one of two tasks is done");
  assert.equal(goal.progress, 50);
  assert.equal(assessment.courseId, course.id);
  const card = await prisma.flashcard.findFirstOrThrow({ where: { userId: b } });
  assert.equal(card.noteId, note.id);
  assert.equal(card.easeFactor, 2.1);
  assert.equal(card.repetitions, 2);
  const steps = await prisma.taskChecklistItem.findMany({ where: { userId: b }, orderBy: { position: "asc" } });
  assert.deepEqual(steps.map((step) => [step.taskId, step.title, step.done]), [[task.id, "Read", true], [task.id, "Practise", false]]);
  const both = await prisma.task.findMany({ where: { userId: b, title: { startsWith: "Revise limits" } } });
  assert.equal(new Set(both.map((row) => row.recurrenceId)).size, 1, "a series stays one series");
  assert.notEqual(both[0].recurrenceId, task.recurrenceId === null ? null : original.task.recurrenceId, "under a new series id");
  // The links between notes are rebuilt from the text.
  assert.equal(await prisma.entityLink.count({ where: { userId: b } }), 1);
  // Account A is as it was.
  assert.deepEqual(await counts(a), { courses: 1, assessments: 1, goals: 1, projects: 1, notes: 2, tasks: 2, steps: 2, events: 1, references: 1, cards: 1 });
});

test("restoring the same file again adds nothing, in the same account or another", async () => {
  const a = await newUser();
  const b = await newUser();
  await fill(a);
  const file = await exportOf(a);
  await restore(b, file, true);
  const before = await counts(b);

  const again = await restore(b, file, true);
  assert.equal(created(again), 0);
  assert.equal(wouldCreate(again), 0);
  assert.deepEqual(await counts(b), before);

  // Restoring into the account it came from adds nothing either: it is all already there.
  const sameAccount = await restore(a, file, true);
  assert.equal(created(sameAccount), 0);
  assert.deepEqual(await counts(a), { courses: 1, assessments: 1, goals: 1, projects: 1, notes: 2, tasks: 2, steps: 2, events: 1, references: 1, cards: 1 });
});

test("an owner, an id and a hash in the file are never used: another account's rows are untouched", async () => {
  const victim = await newUser();
  const me = await newUser();
  const theirs = await fill(victim);
  const before = await counts(victim);
  const note = await prisma.note.findUniqueOrThrow({ where: { id: theirs.note.id } });

  const forged = {
    formatVersion: 2,
    user: { id: victim, email: "x@x", passwordHash: "scrypt$forged" },
    profile: { userId: victim, targetGpa: 4 },
    notes: [{ id: theirs.note.id, userId: victim, title: "Forged", content: "mine now", tags: [], projectId: theirs.project.id, courseId: theirs.course.id, deletedAt: null, updatedAt: "2030-01-01T00:00:00.000Z" }],
    tasks: [{ id: theirs.task.id, userId: victim, title: "Forged task", projectId: theirs.project.id, goalId: theirs.goal.id, courseId: theirs.course.id, noteId: theirs.note.id, assessmentId: theirs.assessment.id }],
    events: [{ id: randomUUID(), userId: victim, title: "Forged event", startTime: "2026-12-01T09:00:00.000Z", endTime: "2026-12-01T10:00:00.000Z", projectId: theirs.project.id, courseId: theirs.course.id }],
    flashcards: [{ noteId: theirs.note.id, question: "Q", answer: "A" }],
    assessments: [{ courseId: theirs.course.id, title: "Forged exam", weight: 10 }],
  };
  const report = await restore(me, forged, true);

  assert.deepEqual(await counts(victim), before, "the victim's rows are neither changed nor added to");
  // A card whose note is in neither the file nor the account has no deck, so it is skipped.
  assert.equal((await restore(me, { flashcards: [{ noteId: theirs.note.id, question: "Q2", answer: "A2" }] }, true)).kinds.flashcards.invalid, 1);
  const after = await prisma.note.findUniqueOrThrow({ where: { id: theirs.note.id } });
  assert.equal(after.title, note.title);
  assert.equal(after.content, note.content);
  assert.equal(after.updatedAt.getTime(), note.updatedAt.getTime());

  const mine = await prisma.note.findFirstOrThrow({ where: { userId: me } });
  assert.notEqual(mine.id, theirs.note.id);
  assert.deepEqual([mine.projectId, mine.courseId], [null, null], "a link to someone else's project or course attaches to nothing");
  const task = await prisma.task.findFirstOrThrow({ where: { userId: me } });
  // The file does hold a note with that id, so the task points at the note made FROM THE FILE in this account; the rest are not in the file.
  assert.deepEqual([task.projectId, task.goalId, task.courseId, task.noteId, task.assessmentId], [null, null, null, mine.id, null]);
  const event = await prisma.event.findFirstOrThrow({ where: { userId: me } });
  assert.deepEqual([event.projectId, event.courseId], [null, null]);
  assert.equal((await prisma.flashcard.findFirstOrThrow({ where: { userId: me } })).noteId, mine.id);
  assert.equal(await prisma.assessment.count({ where: { userId: me } }), 0, "a grade with no course of mine has nowhere to live");
  assert.ok(report.kinds.tasks.unlinked >= 4);
  const profile = await prisma.userProfile.findUnique({ where: { userId: me } });
  assert.equal(profile?.targetGpa ?? null, null, "settings in the file are not applied");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me } });
  assert.equal(user.passwordHash, "x");
});

test("trashed rows are not 'already here': a live copy is added beside them, and the trash stays as it was", async () => {
  const a = await newUser();
  const b = await newUser();
  await fill(a);
  const file = await exportOf(a);
  await prisma.note.create({ data: { userId: b, title: "Derivatives", content: "Slopes.", tags: [], deletedAt: new Date() } });
  await prisma.task.create({ data: { userId: b, title: "Revise limits", dueDate: new Date("2026-11-18T20:59:59Z"), status: "todo", priority: "low", tags: [], deletedAt: new Date() } });
  await restore(b, file, true);
  assert.equal(await prisma.note.count({ where: { userId: b, title: "Derivatives", deletedAt: null } }), 1);
  assert.equal(await prisma.note.count({ where: { userId: b, title: "Derivatives", deletedAt: { not: null } } }), 1);
  assert.equal(await prisma.task.count({ where: { userId: b, title: "Revise limits", deletedAt: null } }), 1);
});

test("a different note under a title the account already uses comes in renamed, and the existing note keeps the title", async () => {
  const b = await newUser();
  await prisma.note.create({ data: { userId: b, title: "Plan", content: "mine", tags: [] } });
  const report = await restore(b, { notes: [{ id: "n1", title: "Plan", content: "theirs" }] }, true);
  assert.deepEqual(report.renamed, [{ from: "Plan", to: "Plan (imported)" }]);
  assert.deepEqual((await prisma.note.findMany({ where: { userId: b }, orderBy: { title: "asc" } })).map((note) => [note.title, note.content]), [["Plan", "mine"], ["Plan (imported)", "theirs"]]);
  const again = await restore(b, { notes: [{ id: "n1", title: "Plan", content: "theirs" }] }, true);
  assert.equal(created(again), 0);
});

test("a run creates at most the note limit; what waits (and what points at it) comes with the next run", async () => {
  const b = await newUser();
  const total = RESTORE_LIMITS.notesPerRun + 1;
  const notes = Array.from({ length: total }, (_, index) => ({ id: `n${String(index).padStart(4, "0")}`, title: `Note ${String(index).padStart(4, "0")}`, content: `text ${index}` }));
  const last = notes[notes.length - 1];
  const file = { notes, tasks: [{ id: "t1", title: "About the last note", noteId: last.id }], flashcards: [{ noteId: last.id, question: "Q", answer: "A" }] };

  const first = await restore(b, file, true);
  assert.equal(first.kinds.notes.created, RESTORE_LIMITS.notesPerRun);
  assert.equal(first.kinds.notes.deferred, 1);
  assert.equal(first.kinds.tasks.deferred, 1, "a task waits for its note rather than losing the link for ever");
  assert.equal(first.kinds.flashcards.deferred, 1);
  assert.equal(await prisma.task.count({ where: { userId: b } }), 0);

  const second = await restore(b, file, true);
  assert.equal(second.kinds.notes.created, 1);
  assert.equal(second.kinds.tasks.created, 1);
  const task = await prisma.task.findFirstOrThrow({ where: { userId: b } });
  const noteOfTask = await prisma.note.findUniqueOrThrow({ where: { id: task.noteId! } });
  assert.equal(noteOfTask.title, last.title);
  assert.equal(await prisma.note.count({ where: { userId: b } }), total);
  assert.equal(created(await restore(b, file, true)), 0);
});

test("events from a calendar feed are not restored, an impossible range is skipped, and a done flag decides completion", async () => {
  const b = await newUser();
  const file = {
    events: [
      { title: "Imported", startTime: "2026-12-01T09:00:00.000Z", endTime: "2026-12-01T10:00:00.000Z", subscriptionId: randomUUID(), externalUid: "abc" },
      { title: "Backwards", startTime: "2026-12-01T10:00:00.000Z", endTime: "2026-12-01T09:00:00.000Z" },
      { title: "Fine", startTime: "2026-12-01T09:00:00.000Z", endTime: "2026-12-01T10:00:00.000Z" },
    ],
    tasks: [
      { title: "Open", status: "todo", completedAt: "2026-01-01T00:00:00.000Z" },
      { title: "Closed", status: "done" },
      { title: "End without start", scheduledEnd: "2026-12-01T10:00:00.000Z" },
    ],
  };
  const report = await restore(b, file, true);
  assert.equal(report.fromFeed, 1);
  assert.equal(report.kinds.events.invalid, 1);
  assert.deepEqual((await prisma.event.findMany({ where: { userId: b } })).map((event) => event.title), ["Fine"]);
  const open = await prisma.task.findFirstOrThrow({ where: { userId: b, title: "Open" } });
  assert.equal(open.completedAt, null, "completion follows status, not a free field of the file");
  assert.ok((await prisma.task.findFirstOrThrow({ where: { userId: b, title: "Closed" } })).completedAt);
  const stray = await prisma.task.findFirstOrThrow({ where: { userId: b, title: "End without start" } });
  assert.equal(stray.scheduledEnd, null);
});

test("a file that is not an export is refused and writes nothing; no account is refused", async () => {
  const b = await newUser();
  for (const text of ["", "garbage", "[]", `{"formatVersion":99,"notes":[]}`, `{"nothing":"useful"}`]) {
    const outcome = await runJsonRestore(b, new TextEncoder().encode(text), { apply: true });
    assert.equal(outcome.ok, false, text);
  }
  assert.deepEqual(await counts(b), { courses: 0, assessments: 0, goals: 0, projects: 0, notes: 0, tasks: 0, steps: 0, events: 0, references: 0, cards: 0 });
  await assert.rejects(() => runJsonRestore("", bytes({ notes: [] }), { apply: true }));
  // The same call with `undefined` would mean "no filter" to Prisma; it is refused before any query.
  await assert.rejects(() => runJsonRestore(undefined as unknown as string, bytes({ notes: [{ title: "x" }] }), { apply: true }));
});

test("a reference with a key the account already has is left alone, and a bad one is counted, not fatal", async () => {
  const b = await newUser();
  await prisma.reference.create({ data: { userId: b, key: "dup", type: "book", title: "Mine", authors: [], year: 2000, details: {} } });
  const report = await restore(
    b,
    {
      references: [
        { key: "dup", type: "book", title: "Theirs", authors: [], year: 2001 },
        { key: "new1", type: "article", title: "New", authors: [{ family: "Ada" }], year: 1843, details: { container: "Notes" } },
        { key: "bad key!", type: "book", title: "Bad", authors: [], year: 2000 },
      ],
    },
    true,
  );
  const preview = await restore(b, { references: [{ key: "bad key!", type: "book", title: "Bad", authors: [], year: 2000 }, { key: "ok1", type: "book", title: "Fine", authors: [], year: 2000 }] }, false);
  assert.deepEqual([preview.kinds.references.create, preview.kinds.references.invalid], [1, 1], "a preview already counts the reference it would refuse");
  assert.equal(report.kinds.references.present, 1);
  assert.equal(report.kinds.references.created, 1);
  assert.equal(report.kinds.references.invalid, 1);
  assert.equal((await prisma.reference.findFirstOrThrow({ where: { userId: b, key: "dup" } })).title, "Mine");
});

test("what an account already holds is read from its own live rows only (each reader, directly)", async () => {
  const { existing } = await import("@/repositories/restore-repository");
  const me = await newUser();
  const other = await newUser();
  for (const userId of [me, other]) {
    const course = await prisma.course.create({ data: { userId, code: "X1", title: "T", term: "Fall" } });
    await prisma.assessment.create({ data: { userId, courseId: course.id, title: "A", weight: 1, maxScore: 10 } });
    await prisma.goal.create({ data: { userId, title: "G", category: "Personal" } });
    await prisma.project.create({ data: { userId, title: "P", category: "Personal" } });
    await prisma.note.create({ data: { userId, title: "N", content: "c", tags: [] } });
    await prisma.task.create({ data: { userId, title: "T", status: "todo", priority: "low", tags: [] } });
    await prisma.event.create({ data: { userId, title: "E", startTime: new Date("2026-12-01T09:00:00Z"), endTime: new Date("2026-12-01T10:00:00Z") } });
    await prisma.flashcard.create({ data: { userId, question: "Q", answer: "A" } });
    await prisma.reference.create({ data: { userId, key: "k", type: "book", title: "R", authors: [], details: {} } });
  }
  // And the trash is not "here": a deleted row of mine is not read either.
  await prisma.course.create({ data: { userId: me, code: "GONE", title: "T", term: "Fall", deletedAt: new Date() } });
  await prisma.goal.create({ data: { userId: me, title: "Gone goal", category: "Personal", deletedAt: new Date() } });
  await prisma.project.create({ data: { userId: me, title: "Gone project", category: "Personal", deletedAt: new Date() } });
  await prisma.note.create({ data: { userId: me, title: "Gone note", content: "c", tags: [], deletedAt: new Date() } });
  await prisma.task.create({ data: { userId: me, title: "Gone task", status: "todo", priority: "low", tags: [], deletedAt: new Date() } });
  const trashedNote = await prisma.note.create({ data: { userId: me, title: "Trashed owner", content: "c", tags: [], deletedAt: new Date() } });
  await prisma.flashcard.create({ data: { userId: me, noteId: trashedNote.id, question: "Gone card", answer: "A" } });

  assert.deepEqual((await existing.courses(me)).map((row) => row.code), ["X1"]);
  assert.equal((await existing.assessments(me)).length, 1);
  assert.deepEqual((await existing.goals(me)).map((row) => row.title), ["G"]);
  assert.deepEqual((await existing.projects(me)).map((row) => row.title), ["P"]);
  assert.deepEqual((await existing.notes(me)).map((row) => row.title), ["N"]);
  assert.deepEqual((await existing.tasks(me)).map((row) => row.title), ["T"]);
  assert.equal((await existing.events(me)).length, 1);
  assert.deepEqual((await existing.flashcards(me)).map((row) => row.question), ["Q"]);
  assert.deepEqual(await existing.referenceKeys(me), ["k"]);
});

test("a task that matches only a trashed one is added, and a note-less card of another account is not 'present'", async () => {
  const me = await newUser();
  const other = await newUser();
  await prisma.task.create({ data: { userId: me, title: "Same", dueDate: new Date("2026-11-18T20:59:59Z"), status: "todo", priority: "low", tags: [], deletedAt: new Date() } });
  await prisma.flashcard.create({ data: { userId: other, question: "Q", answer: "A" } });
  const report = await restore(me, { tasks: [{ title: "Same", dueDate: "2026-11-18T20:59:59.000Z" }], flashcards: [{ question: "Q", answer: "A" }] }, true);
  assert.equal(report.kinds.tasks.created, 1);
  assert.equal(report.kinds.flashcards.created, 1);
});

test("weekly goals are restored one per measure: a measure already held is left alone, an unreadable one is counted, not fatal", async () => {
  const b = await newUser();
  await prisma.weeklyGoal.create({ data: { userId: b, measure: "tasks_finished", target: 4 } });
  const file = {
    weeklyGoals: [
      { measure: "tasks_finished", target: 9 },
      { measure: "cards_reviewed", target: 50 },
      { measure: "pushups", target: 10 },
      { measure: "notes_written", target: 0 },
      { measure: "study_sessions", target: 1000 },
      { measure: "study_minutes", target: 2.5 },
    ],
  };
  const preview = await restore(b, file, false);
  assert.deepEqual([preview.kinds.weeklyGoals.create, preview.kinds.weeklyGoals.present, preview.kinds.weeklyGoals.invalid], [1, 1, 4], "a preview already counts what it would refuse");
  assert.equal(await prisma.weeklyGoal.count({ where: { userId: b } }), 1, "a preview writes nothing");
  const report = await restore(b, file, true);
  assert.equal(report.kinds.weeklyGoals.created, 1);
  const rows = Object.fromEntries((await prisma.weeklyGoal.findMany({ where: { userId: b } })).map((r) => [r.measure, r.target]));
  assert.deepEqual(rows, { tasks_finished: 4, cards_reviewed: 50 }, "the goal I already had keeps its target");
  const again = await restore(b, file, true);
  assert.equal(again.kinds.weeklyGoals.created, 0, "restoring the same file adds nothing");
});
