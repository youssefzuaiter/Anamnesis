/**
 * Study time per course against a real Postgres, DB-only like the rest of this tier: the three switches,
 * what each kind of session may store, and what the page reads back. The rules live in the service (the
 * actions only parse and call it), so they are exercised here without a session. Each test makes its own
 * account so one test's rows cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import * as focus from "@/services/focus-service";

const users: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `study-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const makeCourse = (userId: string, code: string, extra: Record<string, unknown> = {}) =>
  prisma.course.create({ data: { userId, code, title: `Title of ${code}`, term: "Fall 2026", ...extra } });
const makeTask = (userId: string, extra: Record<string, unknown> = {}) =>
  prisma.task.create({ data: { userId, title: "A task", ...extra } });

const refused = (code: AppError["code"], message: string) => (error: unknown) =>
  error instanceof AppError && error.code === code && error.message === message;

const writing = (courseId?: string | null) => ({ activeSeconds: 120, charactersTyped: 600, typingSpeedWpm: 50, courseId });
const written = (userId: string) => prisma.focusTelemetry.findMany({ where: { userId } });
const timed = (userId: string) => prisma.studySession.findMany({ where: { userId } });

// --- The switches -------------------------------------------------------------------------------------

test("an account that never chose anything has every switch off", async () => {
  const user = await newUser();
  assert.deepEqual(await focus.getSettings(user.id), { tracking: false, includeCourse: false, timer: false });
});

test("the course switch cannot be turned on while tracking is off, and says why", async () => {
  const user = await newUser();
  await assert.rejects(() => focus.setIncludeCourse(user.id, true), refused("FORBIDDEN", "Turn on Record focus sessions first."));
  assert.deepEqual(await focus.getSettings(user.id), { tracking: false, includeCourse: false, timer: false });
  await focus.setTracking(user.id, true);
  assert.deepEqual(await focus.setIncludeCourse(user.id, true), { tracking: true, includeCourse: true, timer: false });
  assert.deepEqual(await focus.setIncludeCourse(user.id, false), { tracking: true, includeCourse: false, timer: false });
  // Turning something off is always allowed.
  const other = await newUser();
  assert.deepEqual(await focus.setIncludeCourse(other.id, false), { tracking: false, includeCourse: false, timer: false });
});

test("turning tracking off turns the course switch off too, and turning it on does not turn the course on", async () => {
  const user = await newUser();
  await focus.setTracking(user.id, true);
  assert.equal((await focus.getSettings(user.id)).includeCourse, false, "tracking on does not imply the course");
  await focus.setIncludeCourse(user.id, true);
  await focus.setTimerSessions(user.id, true);
  assert.deepEqual(await focus.setTracking(user.id, false), { tracking: false, includeCourse: false, timer: true });
  assert.deepEqual(await focus.setTracking(user.id, true), { tracking: true, includeCourse: false, timer: true });
});

test("the timer switch is its own consent, independent of tracking", async () => {
  const user = await newUser();
  assert.deepEqual(await focus.setTimerSessions(user.id, true), { tracking: false, includeCourse: false, timer: true });
  assert.deepEqual(await focus.setTimerSessions(user.id, false), { tracking: false, includeCourse: false, timer: false });
});

// --- Writing sessions ---------------------------------------------------------------------------------

test("a writing session is refused while tracking is off, and nothing is stored", async () => {
  const user = await newUser();
  const course = await makeCourse(user.id, "CS 301");
  await assert.rejects(() => focus.recordWritingSession(user.id, writing(course.id)), refused("FORBIDDEN", "Focus tracking is off."));
  assert.equal((await written(user.id)).length, 0);
});

test("a session too short to mean anything, or with nothing typed, is dropped quietly whatever the switches say", async () => {
  const user = await newUser();
  await focus.recordWritingSession(user.id, { ...writing(), activeSeconds: 29 });
  await focus.setTracking(user.id, true);
  await focus.recordWritingSession(user.id, { ...writing(), activeSeconds: 29 });
  await focus.recordWritingSession(user.id, { ...writing(), charactersTyped: 0 });
  assert.equal((await written(user.id)).length, 0);
  await focus.recordWritingSession(user.id, { ...writing(), activeSeconds: 30 });
  assert.equal((await written(user.id)).length, 1, "exactly thirty seconds is kept");
});

test("with tracking on and the course off, the session is kept and the course is not, even if the browser sends one", async () => {
  const user = await newUser();
  const course = await makeCourse(user.id, "CS 301");
  await focus.setTracking(user.id, true);
  await focus.recordWritingSession(user.id, writing(course.id));
  const [row] = await written(user.id);
  assert.equal(row.courseId, null);
  assert.equal(row.sessionDuration, 120);
  assert.equal(row.typingSpeedWpm, 50);
  assert.equal(row.cognitiveLoad, "steady");
});

test("with both on, the session keeps the course of the note", async () => {
  const user = await newUser();
  const course = await makeCourse(user.id, "CS 301");
  await focus.setTracking(user.id, true);
  await focus.setIncludeCourse(user.id, true);
  await focus.recordWritingSession(user.id, writing(course.id));
  await focus.recordWritingSession(user.id, writing(null));
  await focus.recordWritingSession(user.id, writing(undefined));
  const rows = (await written(user.id)).map((row) => row.courseId).sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepEqual(rows.filter((id) => id === course.id).length, 1);
  assert.equal(rows.filter((id) => id === null).length, 2);
});

test("another account's course, and one that does not exist, are stored as no course and the call looks the same", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  const foreign = await makeCourse(theirs.id, "SECRET 1");
  await focus.setTracking(mine.id, true);
  await focus.setIncludeCourse(mine.id, true);
  await focus.recordWritingSession(mine.id, writing(foreign.id));
  await focus.recordWritingSession(mine.id, writing(randomUUID()));
  const rows = await written(mine.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.courseId), [null, null]);
  assert.equal((await written(theirs.id)).length, 0);
});

// --- Timer sessions -----------------------------------------------------------------------------------

test("a timer session is refused while the switch is off, whatever the task, and nothing is stored", async () => {
  const user = await newUser();
  const task = await makeTask(user.id);
  await assert.rejects(() => focus.recordTimerSession(user.id, { taskId: task.id, seconds: 1500 }), refused("FORBIDDEN", "Remembering timer sessions is off."));
  const theirs = await newUser();
  const foreignTask = await makeTask(theirs.id);
  await assert.rejects(() => focus.recordTimerSession(user.id, { taskId: foreignTask.id, seconds: 1500 }), refused("FORBIDDEN", "Remembering timer sessions is off."), "the off switch answers before the task is looked at");
  assert.equal((await timed(user.id)).length, 0);
});

test("a remembered timer session stores the seconds and the task's course, and says which course", async () => {
  const user = await newUser();
  const course = await makeCourse(user.id, "CS 301");
  const task = await makeTask(user.id, { courseId: course.id });
  const bare = await makeTask(user.id);
  await focus.setTimerSessions(user.id, true);
  assert.deepEqual(await focus.recordTimerSession(user.id, { taskId: task.id, seconds: 1500 }), { saved: true, seconds: 1500, courseCode: "CS 301" });
  assert.deepEqual(await focus.recordTimerSession(user.id, { taskId: bare.id, seconds: 600 }), { saved: true, seconds: 600, courseCode: null });
  const rows = await timed(user.id);
  assert.deepEqual(rows.map((row) => [row.seconds, row.courseId]).sort(), [[1500, course.id], [600, null]]);
});

test("another account's task, a trashed task and a task that does not exist all get the same refusal and store nothing", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  const foreign = await makeTask(theirs.id);
  const trashed = await makeTask(mine.id, { deletedAt: new Date() });
  await focus.setTimerSessions(mine.id, true);
  for (const taskId of [foreign.id, trashed.id, randomUUID()]) {
    await assert.rejects(() => focus.recordTimerSession(mine.id, { taskId, seconds: 1500 }), refused("RESOURCE_NOT_FOUND", "That task no longer exists."), taskId);
  }
  assert.equal((await timed(mine.id)).length, 0);
  assert.equal((await timed(theirs.id)).length, 0);
});

test("a task whose course is in the trash is still remembered, without naming the course", async () => {
  const user = await newUser();
  const trashedCourse = await makeCourse(user.id, "OLD 1", { deletedAt: new Date() });
  const task = await makeTask(user.id, { courseId: trashedCourse.id });
  await focus.setTimerSessions(user.id, true);
  assert.deepEqual(await focus.recordTimerSession(user.id, { taskId: task.id, seconds: 900 }), { saved: true, seconds: 900, courseCode: null });
  assert.equal((await timed(user.id))[0].courseId, trashedCourse.id, "it comes back if the course is restored");
});

test("a timer run under thirty seconds is dropped quietly, exactly thirty is kept", async () => {
  const user = await newUser();
  const task = await makeTask(user.id);
  assert.deepEqual(await focus.recordTimerSession(user.id, { taskId: task.id, seconds: 10 }), { saved: false, seconds: 0, courseCode: null }, "switch off and short: no error either");
  await focus.setTimerSessions(user.id, true);
  assert.equal((await focus.recordTimerSession(user.id, { taskId: task.id, seconds: 29 })).saved, false);
  assert.equal((await focus.recordTimerSession(user.id, { taskId: task.id, seconds: 30 })).saved, true);
  assert.deepEqual((await timed(user.id)).map((row) => row.seconds), [30]);
});

test("a timer row can only say how long and for which course, never what on", async () => {
  const columns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'StudySession' ORDER BY column_name`;
  assert.deepEqual(columns.map((c) => c.column_name), ["courseId", "id", "recordedAt", "seconds", "userId"]);
});

// --- Deleting -----------------------------------------------------------------------------------------

test("delete all removes both kinds for this account only, and counts them", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  for (const user of [mine, theirs]) {
    await prisma.focusTelemetry.createMany({ data: [1, 2, 3].map((n) => ({ userId: user.id, sessionDuration: 60 * n, typingSpeedWpm: 30, cognitiveLoad: "light" })) });
    await prisma.studySession.createMany({ data: [1, 2].map((n) => ({ userId: user.id, seconds: 60 * n })) });
  }
  assert.equal(await focus.clearHistory(mine.id), 5);
  assert.equal((await written(mine.id)).length + (await timed(mine.id)).length, 0);
  assert.equal((await written(theirs.id)).length, 3);
  assert.equal((await timed(theirs.id)).length, 2);
  assert.equal(await focus.clearHistory(mine.id), 0, "nothing left to delete");
});

test("deleting a course keeps its sessions as no course", async () => {
  const user = await newUser();
  const course = await makeCourse(user.id, "GONE 1");
  await prisma.focusTelemetry.create({ data: { userId: user.id, courseId: course.id, sessionDuration: 60, typingSpeedWpm: 30, cognitiveLoad: "light" } });
  await prisma.studySession.create({ data: { userId: user.id, courseId: course.id, seconds: 60 } });
  await prisma.course.delete({ where: { id: course.id } });
  assert.deepEqual((await written(user.id)).map((row) => row.courseId), [null]);
  assert.deepEqual((await timed(user.id)).map((row) => row.courseId), [null]);
});
