/**
 * The focus timer that lives on the server (ROADMAP item 40), against a real Postgres. It keeps running while the person browses, saves study
 * time once and only for focus, takes breaks, rings a phone at most once, and is one per account that nobody else can touch. A fake publisher
 * stands in for ntfy, so nothing is sent.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Publish, PushMessage } from "@/lib/ntfy";
import * as timer from "@/services/focus-timer-service";
import * as timerRepo from "@/repositories/focus-timer-repository";

const made: string[] = [];
async function newUser(options: { remember?: boolean; push?: boolean } = {}): Promise<string> {
  const user = await prisma.user.create({ data: { email: `timer-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  if (options.remember !== undefined || options.push) {
    await prisma.userProfile.create({
      data: { userId: user.id, timerSessionsEnabled: options.remember ?? false, ...(options.push ? { pushEnabled: true, ntfyTopic: `anamnesis-${randomUUID().slice(0, 8)}` } : {}) },
    });
  }
  return user.id;
}
after(async () => {
  timer.cancelAllArmed();
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const T0 = new Date("2026-11-16T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const task = (userId: string, extra: Record<string, unknown> = {}) =>
  prisma.task.create({ data: { userId, title: "Revise limits", status: "todo", priority: "low", tags: [], ...extra } });
const sessions = (userId: string) => prisma.studySession.findMany({ where: { userId }, orderBy: { recordedAt: "asc" } });
function fakePublisher() {
  const sent: PushMessage[] = [];
  const publish: Publish = async (message) => {
    sent.push(message);
  };
  return { sent, publish };
}
const opts = (now: Date, publish?: Publish) => ({ now, publish });

test("there is no timer until one is started, and a started one is running with its end fixed", async () => {
  const me = await newUser();
  assert.equal(await timer.getTimer(me, opts(T0)), null);
  const t = await task(me);
  const snapshot = await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(T0));
  assert.equal(snapshot.view.status, "running");
  assert.equal(snapshot.view.remaining, 1500);
  assert.equal(snapshot.taskTitle, "Revise limits");
  assert.equal(snapshot.endsAt, at(1500).toISOString());
  assert.equal(snapshot.serverNow, T0.toISOString());
  assert.equal((await timer.getTimer(me, opts(at(60))))!.view.remaining, 1440, "read again later, it has moved on by itself");
});

test("only the lengths in the design are accepted, and only a live task of the caller's", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await task(me);
  const theirs = await task(other);
  const trashed = await task(me, { deletedAt: new Date() });
  for (const minutes of [0, 1, 26, 90, -25, 25.5]) {
    await assert.rejects(() => timer.startTimer(me, { taskId: mine.id, minutes, notify: false }, opts(T0)), { code: "VALIDATION_ERROR" }, String(minutes));
  }
  for (const taskId of [theirs.id, trashed.id, randomUUID()]) {
    await assert.rejects(() => timer.startTimer(me, { taskId, minutes: 25, notify: false }, opts(T0)), (e: { code?: string; message?: string }) => e.code === "RESOURCE_NOT_FOUND" && e.message === "That task no longer exists.");
  }
  assert.equal(await prisma.activeTimer.count({ where: { userId: { in: [me, other] } } }), 0);
  await assert.rejects(() => timer.startTimer("", { taskId: mine.id, minutes: 25, notify: false }, opts(T0)), { code: "AUTH_REQUIRED" });
});

test("pausing and resuming move the end, a paused timer does not run, and the time paused is not study time", async () => {
  const me = await newUser({ remember: true });
  const t = await task(me);
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(T0));
  const paused = await timer.pauseTimer(me, opts(at(600)));
  assert.equal(paused.view.status, "paused");
  assert.equal(paused.view.remaining, 900);
  assert.equal((await timer.getTimer(me, opts(at(99_999))))!.view.remaining, 900);
  const resumed = await timer.resumeTimer(me, opts(at(5000)));
  assert.equal(resumed.endsAt, at(5900).toISOString());
  await assert.rejects(() => timer.resumeTimer(me, opts(at(5001))), { code: "VALIDATION_ERROR" });
  assert.equal((await sessions(me)).length, 0, "nothing is saved until the session ends");
  const done = await timer.getTimer(me, opts(at(5900)));
  assert.equal(done!.view.status, "done");
  assert.deepEqual((await sessions(me)).map((s) => s.seconds), [1500], "the full session, not the 5,900 seconds on the clock");
});

test("a session that runs out is saved once, whoever notices and however many times it is read", async () => {
  const me = await newUser({ remember: true });
  const t = await task(me);
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(T0));
  const [a, b, c] = await Promise.all([timer.getTimer(me, opts(at(1600))), timer.getTimer(me, opts(at(1601))), timer.getTimer(me, opts(at(2000)))]);
  for (const snapshot of [a, b, c]) assert.equal(snapshot!.view.status, "done");
  await timer.getTimer(me, opts(at(3000)));
  const saved = await sessions(me);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].seconds, 1500);
  assert.equal(a!.savedSeconds, 1500);
  const done = await timer.getTimer(me, opts(at(3000)));
  assert.equal(done!.view.session, 1);
});

test("study time goes under the task's course, and is not saved at all when remembering is off", async () => {
  const me = await newUser({ remember: true });
  const course = await prisma.course.create({ data: { userId: me, code: "CMP1", title: "T", term: "F" } });
  const t = await task(me, { courseId: course.id });
  await timer.startTimer(me, { taskId: t.id, minutes: 15, notify: false }, opts(T0));
  const snapshot = await timer.getTimer(me, opts(at(900)));
  assert.equal(snapshot!.courseCode, "CMP1");
  assert.deepEqual((await sessions(me)).map((s) => [s.courseId, s.seconds]), [[course.id, 900]]);

  const off = await newUser({ remember: false });
  const t2 = await task(off);
  await timer.startTimer(off, { taskId: t2.id, minutes: 15, notify: false }, opts(T0));
  const done = await timer.getTimer(off, opts(at(900)));
  assert.equal(done!.view.status, "done");
  assert.equal(done!.rememberOn, false);
  assert.equal((await sessions(off)).length, 0);
});

test("a reset part way saves what ran, once, and leaves a timer ready to start; under 30 seconds saves nothing", async () => {
  const me = await newUser({ remember: true });
  const t = await task(me);
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(T0));
  const ready = await timer.resetTimer(me, opts(at(600)));
  assert.equal(ready.view.status, "ready");
  assert.equal(ready.view.remaining, 1500);
  assert.deepEqual((await sessions(me)).map((s) => s.seconds), [600]);
  await timer.resumeTimer(me, opts(at(700)));
  await timer.resetTimer(me, opts(at(710)));
  assert.equal((await sessions(me)).length, 1, "ten seconds is not a study session");
  await timer.resumeTimer(me, opts(at(800)));
  await timer.pauseTimer(me, opts(at(1100)));
  await timer.resetTimer(me, opts(at(1200)));
  assert.deepEqual((await sessions(me)).map((s) => s.seconds), [600, 300]);
});

test("a break follows a finished session, is never study time, and the fourth session earns a long one", async () => {
  const me = await newUser({ remember: true });
  const t = await task(me);
  let clock = 0;
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(at(clock)));
  for (let session = 1; session <= 4; session++) {
    clock += 1500;
    const done = await timer.getTimer(me, opts(at(clock)));
    assert.equal(done!.view.status, "done");
    assert.equal(done!.view.session, session);
    assert.equal(done!.view.next, session === 4 ? "long_break" : "break");
    const brk = await timer.startBreakTimer(me, opts(at(clock)));
    assert.equal(brk.view.phase, session === 4 ? "long_break" : "break");
    clock += session === 4 ? 900 : 300;
    const brkDone = await timer.getTimer(me, opts(at(clock)));
    assert.equal(brkDone!.view.status, "done");
    assert.equal(brkDone!.view.next, "focus");
    if (session < 4) await timer.startNextFocusTimer(me, opts(at(clock)));
    else {
      const next = await timer.startNextFocusTimer(me, opts(at(clock)));
      assert.equal(next.view.session, 1, "a new round");
    }
  }
  assert.deepEqual((await sessions(me)).map((s) => s.seconds), [1500, 1500, 1500, 1500], "four focus sessions, no break time");
});

test("skipping to a break saves what ran and counts the session; skipping a break gets a session ready; stopping ends it", async () => {
  const me = await newUser({ remember: true });
  const t = await task(me);
  await timer.startTimer(me, { taskId: t.id, minutes: 50, notify: false }, opts(T0));
  const brk = await timer.skipToBreakTimer(me, opts(at(1200)));
  assert.equal(brk.view.phase, "break");
  assert.equal(brk.view.session, 2, "the next focus session is the second");
  assert.deepEqual((await sessions(me)).map((s) => s.seconds), [1200]);
  const ready = await timer.skipBreakTimer(me, opts(at(1300)));
  assert.equal(ready.view.status, "ready");
  assert.equal(ready.view.remaining, 3000, "the length chosen is kept");
  assert.equal(ready.view.session, 2);
  await timer.stopTimer(me, opts(at(1400)));
  assert.equal(await timer.getTimer(me, opts(at(1400))), null);
  assert.equal(await prisma.activeTimer.count({ where: { userId: me } }), 0);
});

test("starting on another task saves the old one's time and replaces it: one timer per account", async () => {
  const me = await newUser({ remember: true });
  const a = await task(me);
  const b = await task(me, { title: "Other task" });
  await timer.startTimer(me, { taskId: a.id, minutes: 25, notify: false }, opts(T0));
  const second = await timer.startTimer(me, { taskId: b.id, minutes: 15, notify: false }, opts(at(400)));
  assert.equal(second.taskTitle, "Other task");
  assert.equal(second.view.remaining, 900);
  assert.deepEqual((await sessions(me)).map((s) => s.seconds), [400]);
  assert.equal(await prisma.activeTimer.count({ where: { userId: me } }), 1);
});

test("the phone rings once when a session ends, only if asked and set up, and a failing publisher never breaks the timer", async () => {
  const me = await newUser({ remember: true, push: true });
  const t = await task(me);
  const { sent, publish } = fakePublisher();
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: true }, opts(T0, publish));
  await Promise.all([timer.getTimer(me, opts(at(1600), publish)), timer.getTimer(me, opts(at(1601), publish)), timer.getTimer(me, opts(at(1700), publish))]);
  assert.equal(sent.length, 1, "claimed once, however many readers notice");
  assert.match(sent[0].title, /Focus session done/);
  assert.match(sent[0].body, /Revise limits/);
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: me } });
  assert.equal(sent[0].topic, profile.ntfyTopic);

  await timer.startBreakTimer(me, opts(at(1700), publish));
  await timer.getTimer(me, opts(at(2000), publish));
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /Break over/);

  // Not asked: nothing. Not set up: nothing.
  const quiet = await newUser({ remember: true, push: true });
  const t2 = await task(quiet);
  const silent = fakePublisher();
  await timer.startTimer(quiet, { taskId: t2.id, minutes: 15, notify: false }, opts(T0, silent.publish));
  await timer.getTimer(quiet, opts(at(900), silent.publish));
  assert.equal(silent.sent.length, 0);
  const noPhone = await newUser({ remember: true });
  const t3 = await task(noPhone);
  const none = fakePublisher();
  await timer.startTimer(noPhone, { taskId: t3.id, minutes: 15, notify: true }, opts(T0, none.publish));
  assert.equal((await timer.getTimer(noPhone, opts(at(900), none.publish)))!.view.status, "done");
  assert.equal(none.sent.length, 0);

  // A publisher that throws: the session still finishes and saves.
  const broken = await newUser({ remember: true, push: true });
  const t4 = await task(broken);
  const failing: Publish = async () => {
    throw new Error("ntfy answered 500");
  };
  await timer.startTimer(broken, { taskId: t4.id, minutes: 15, notify: true }, opts(T0, failing));
  assert.equal((await timer.getTimer(broken, opts(at(900), failing)))!.view.status, "done");
  assert.equal((await sessions(broken)).length, 1);
});

test("one account's timer is invisible and untouchable to another, and every command needs an account", async () => {
  const me = await newUser({ remember: true });
  const other = await newUser({ remember: true });
  const t = await task(me);
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(T0));
  assert.equal(await timer.getTimer(other, opts(T0)), null);
  for (const command of [timer.pauseTimer, timer.resumeTimer, timer.resetTimer, timer.skipToBreakTimer, timer.startBreakTimer, timer.skipBreakTimer, timer.startNextFocusTimer]) {
    await assert.rejects(() => command(other, opts(T0)), { code: "VALIDATION_ERROR" });
  }
  await timer.stopTimer(other, opts(T0));
  const still = await timer.getTimer(me, opts(at(10)));
  assert.equal(still!.view.status, "running", "the other account's commands changed nothing");
  for (const command of [timer.getTimer, timer.pauseTimer, timer.stopTimer]) await assert.rejects(() => command("", opts(T0)), { code: "AUTH_REQUIRED" });
});

test("a deleted task does not stop the timer: its time still goes under its course, and under none if the task is gone for good", async () => {
  const me = await newUser({ remember: true });
  const course = await prisma.course.create({ data: { userId: me, code: "GONE1", title: "T", term: "F" } });
  const trashed = await task(me, { courseId: course.id });
  await timer.startTimer(me, { taskId: trashed.id, minutes: 15, notify: false }, opts(T0));
  await prisma.task.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
  const done = await timer.getTimer(me, opts(at(900)));
  assert.equal(done!.view.status, "done");
  assert.equal(done!.taskTitle, null, "a deleted task has no title to show");
  assert.deepEqual((await sessions(me)).map((s) => [s.courseId, s.seconds]), [[course.id, 900]], "the time still happened, under the task's course");

  const purged = await task(me, { courseId: course.id });
  await timer.startTimer(me, { taskId: purged.id, minutes: 15, notify: false }, opts(at(1000)));
  await prisma.task.delete({ where: { id: purged.id } });
  await timer.getTimer(me, opts(at(1900)));
  assert.deepEqual((await sessions(me)).map((s) => s.courseId), [course.id, null]);
});

test("a task whose course is in the trash is still remembered, and keeps the link so the time returns if the course does", async () => {
  const me = await newUser({ remember: true });
  const trashedCourse = await prisma.course.create({ data: { userId: me, code: "OLD 1", title: "T", term: "F", deletedAt: new Date() } });
  const t = await task(me, { courseId: trashedCourse.id });
  await timer.startTimer(me, { taskId: t.id, minutes: 15, notify: false }, opts(T0));
  const done = await timer.getTimer(me, opts(at(900)));
  assert.equal(done!.courseCode, null, "a course in the trash is not named");
  assert.deepEqual((await sessions(me)).map((s) => [s.courseId, s.seconds]), [[trashedCourse.id, 900]]);
});

test("a run of under thirty seconds is dropped quietly, exactly thirty is kept", async () => {
  const me = await newUser({ remember: true });
  const t = await task(me);
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(T0));
  await timer.resetTimer(me, opts(at(29)));
  assert.equal((await sessions(me)).length, 0);
  await timer.resumeTimer(me, opts(at(100)));
  await timer.resetTimer(me, opts(at(130)));
  assert.deepEqual((await sessions(me)).map((s) => s.seconds), [30]);
});

test("the database refuses a timer that is two states at once, or none", async () => {
  const me = await newUser();
  const row = { userId: me, phase: "focus", focusMinutes: 25, phaseSeconds: 1500 };
  await assert.rejects(() => prisma.activeTimer.create({ data: { ...row, endsAt: T0, pausedRemaining: 10 } }));
  await assert.rejects(() => prisma.activeTimer.create({ data: { ...row } }));
  await prisma.activeTimer.create({ data: { ...row, finishedAt: T0 } });
});

test("a command that finds no timer says so, and stopping on a stale reading changes nothing", async () => {
  const me = await newUser();
  await assert.rejects(() => timer.pauseTimer(me, opts(T0)), { code: "VALIDATION_ERROR", message: "There is no timer running." });
  const t = await task(me);
  await timer.startTimer(me, { taskId: t.id, minutes: 25, notify: false }, opts(T0));
  const stale = (await timerRepo.getTimer(me))!;
  await timer.pauseTimer(me, opts(at(60)));
  // Someone paused it since this reading was taken: deleting by the old reading must lose, not erase the newer state.
  assert.equal(await timerRepo.change(me, stale, null, null), false);
  assert.equal((await timer.getTimer(me, opts(at(61))))!.view.status, "paused");
});

test("starting again on the same task keeps the round going; another task begins a new one", async () => {
  const me = await newUser();
  const one = await task(me);
  const two = await task(me, { title: "Another" });
  await timer.startTimer(me, { taskId: one.id, minutes: 25, notify: false }, opts(T0));
  await timer.getTimer(me, opts(at(1500)));
  const again = await timer.startTimer(me, { taskId: one.id, minutes: 25, notify: false }, opts(at(1600)));
  assert.equal(again.view.completedFocus, 1, "same task: the finished session still counts");
  const other = await timer.startTimer(me, { taskId: two.id, minutes: 25, notify: false }, opts(at(1700)));
  assert.equal(other.view.completedFocus, 0, "another task: a new round");
});
