/**
 * Weekly goals (ROADMAP item 44) against a real Postgres: one goal per measure, only the owner's, counted from what the account's own rows say
 * about the week we are in and the eight before it, and carried by a restore.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import * as goals from "@/services/weekly-goal-service";
import { listNoteCreations } from "@/repositories/stats-repository";
import { startOfWeek } from "@/lib/study-stats";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `wg-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});
const refusedAs = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

// A fixed Wednesday: this week is Mon 16 Nov – Sun 22 Nov 2026.
const NOW = new Date(2026, 10, 18, 12, 0, 0);
const at = (d: number, h = 10, m = 11) => new Date(2026, m - 1, d, h, 0, 0);

test("a goal is a measure and a target, one per measure, and the rest of the list is what is left to offer", async () => {
  const me = await newUser();
  const empty = await goals.getWeeklyGoals(me, NOW);
  assert.deepEqual(empty.goals, []);
  assert.equal(empty.available.length, 5);
  assert.equal(empty.week, "Mon 16 – Sun 22 Nov");

  await goals.createGoal(me, { measure: "study_sessions", target: 3 });
  await assert.rejects(() => goals.createGoal(me, { measure: "study_sessions", target: 4 }), (e: unknown) => refusedAs("VALIDATION_ERROR")(e) && /already have/.test((e as Error).message));
  const view = await goals.getWeeklyGoals(me, NOW);
  assert.deepEqual(view.goals.map((g) => [g.measure, g.target, g.label]), [["study_sessions", 3, "3 study sessions"]]);
  assert.deepEqual(view.available, ["study_minutes", "cards_reviewed", "tasks_finished", "notes_written"]);
});

test("invalid goals are refused and write nothing", async () => {
  const me = await newUser();
  for (const bad of [{ measure: "steps", target: 3 }, { measure: "study_sessions", target: 0 }, { measure: "study_sessions", target: 1000 }, { measure: "study_sessions", target: 2.5 }, { measure: "study_sessions", target: "3" }, { target: 3 }, null, "x", []]) {
    await assert.rejects(() => goals.createGoal(me, bad), refusedAs("VALIDATION_ERROR"), JSON.stringify(bad));
  }
  assert.equal(await prisma.weeklyGoal.count({ where: { userId: me } }), 0);
});

test("the target of a goal can change, and a goal can go; only the owner's, with one refusal for everything else", async () => {
  const me = await newUser();
  const other = await newUser();
  await goals.createGoal(me, { measure: "tasks_finished", target: 5 });
  await goals.createGoal(other, { measure: "tasks_finished", target: 9 });
  const mine = (await prisma.weeklyGoal.findFirstOrThrow({ where: { userId: me } })).id;
  const theirs = (await prisma.weeklyGoal.findFirstOrThrow({ where: { userId: other } })).id;

  await goals.setGoalTarget(me, mine, 7);
  assert.equal((await prisma.weeklyGoal.findUniqueOrThrow({ where: { id: mine } })).target, 7);
  for (const id of [theirs, randomUUID(), "nope", "", "' OR 1=1 --"]) {
    await assert.rejects(() => goals.setGoalTarget(me, id, 1), refusedAs("RESOURCE_NOT_FOUND"), id);
    await assert.rejects(() => goals.removeGoal(me, id), refusedAs("RESOURCE_NOT_FOUND"), id);
  }
  assert.equal((await prisma.weeklyGoal.findUniqueOrThrow({ where: { id: theirs } })).target, 9, "nothing of theirs changed");
  for (const bad of [0, 1000, 1.5, "7", null]) await assert.rejects(() => goals.setGoalTarget(me, mine, bad), refusedAs("VALIDATION_ERROR"), String(bad));
  assert.equal((await prisma.weeklyGoal.findUniqueOrThrow({ where: { id: mine } })).target, 7);
  await goals.removeGoal(me, mine);
  assert.equal(await prisma.weeklyGoal.count({ where: { userId: me } }), 0);
  assert.equal(await prisma.weeklyGoal.count({ where: { userId: other } }), 1);
});

test("a week is counted from the account's own tasks, cards, study sessions and notes, and nobody else's", async () => {
  const me = await newUser();
  const other = await newUser();
  for (const [measure, target] of [["study_sessions", 3], ["study_minutes", 60], ["cards_reviewed", 5], ["tasks_finished", 2], ["notes_written", 2]] as const) await goals.createGoal(me, { measure, target });

  await prisma.studySession.createMany({ data: [{ userId: me, seconds: 1500, recordedAt: at(16) }, { userId: me, seconds: 1800, recordedAt: at(18, 9) }, { userId: me, seconds: 900, recordedAt: at(15, 23) }, { userId: other, seconds: 9999, recordedAt: at(17) }] });
  await prisma.cardReview.createMany({ data: [{ userId: me, grade: "good", reviewedAt: at(17) }, { userId: me, grade: "again", reviewedAt: at(18) }, { userId: other, grade: "good", reviewedAt: at(17) }] });
  await prisma.task.createMany({ data: [
    { userId: me, title: "done", status: "done", priority: "low", tags: [], completedAt: at(17) },
    { userId: me, title: "done and deleted", status: "done", priority: "low", tags: [], completedAt: at(18, 8), deletedAt: new Date() },
    { userId: me, title: "open", status: "todo", priority: "low", tags: [] },
    { userId: other, title: "theirs", status: "done", priority: "low", tags: [], completedAt: at(17) },
  ] });
  await prisma.note.createMany({ data: [
    { userId: me, title: "a", content: "x", tags: [], createdAt: at(16) },
    { userId: me, title: "trashed", content: "x", tags: [], createdAt: at(17), deletedAt: new Date() },
    { userId: other, title: "theirs", content: "x", tags: [], createdAt: at(17) },
  ] });

  const view = await goals.getWeeklyGoals(me, NOW);
  const by = Object.fromEntries(view.goals.map((g) => [g.measure, g.progress]));
  assert.deepEqual([by.study_sessions.count, by.study_minutes.count], [2, 55], "Sunday night's session is last week's");
  assert.equal(by.cards_reviewed.count, 2);
  assert.equal(by.tasks_finished.count, 2, "a task finished and deleted afterwards was still finished; an open one and another account's were not");
  assert.equal(by.notes_written.count, 2, "a note written and trashed was still written");
  assert.deepEqual([by.study_sessions.reached, by.tasks_finished.reached, by.notes_written.reached, by.study_minutes.reached], [false, true, true, false]);
  const sessions = view.goals.find((g) => g.measure === "study_sessions")!;
  assert.equal(sessions.past.total, 8);
  assert.equal(sessions.past.marks.length, 8);
  assert.equal(sessions.past.reached, 0, "one session last week does not reach 3");
});

test("past weeks are marked against the target as it is now", async () => {
  const me = await newUser();
  await goals.createGoal(me, { measure: "tasks_finished", target: 2 });
  await prisma.task.createMany({ data: [at(9), at(10), at(2), at(3), at(4)].map((completedAt, i) => ({ userId: me, title: `t${i}`, status: "done", priority: "low", tags: [], completedAt })) });
  const two = (await goals.getWeeklyGoals(me, NOW)).goals[0];
  assert.deepEqual([two.past.reached, two.past.marks.slice(-2)], [2, [true, true]], "the week of 2 Nov has three and the week of 9 Nov has two: both reach 2");
  await goals.setGoalTarget(me, (await prisma.weeklyGoal.findFirstOrThrow({ where: { userId: me } })).id, 3);
  const three = (await goals.getWeeklyGoals(me, NOW)).goals[0];
  assert.equal(three.past.reached, 1, "raising the target changes how the past reads");
});

test("the note-creation read is scoped to the caller on its own (the service would mask a missing filter)", async () => {
  const me = await newUser();
  const other = await newUser();
  await prisma.note.create({ data: { userId: me, title: "mine", content: "x", tags: [], createdAt: at(17) } });
  await prisma.note.create({ data: { userId: other, title: "theirs", content: "x", tags: [], createdAt: at(17) } });
  const rows = await listNoteCreations(me, startOfWeek(NOW), new Date(2026, 10, 23));
  assert.equal(rows.length, 1);
  assert.deepEqual(await listNoteCreations(me, new Date(2026, 10, 23), new Date(2026, 10, 24)), []);
});

test("with no goal nothing is read, and a stored measure that is not one of the five is not shown", async () => {
  const me = await newUser();
  await prisma.weeklyGoal.create({ data: { userId: me, measure: "pushups", target: 10 } });
  const view = await goals.getWeeklyGoals(me, NOW);
  assert.deepEqual(view.goals, []);
  assert.equal(view.available.length, 5);
});

test("the study goals say whether timer sessions are being remembered", async () => {
  const me = await newUser();
  assert.equal((await goals.getWeeklyGoals(me, NOW)).recorderOn, false);
  await prisma.userProfile.create({ data: { userId: me, timerSessionsEnabled: true } });
  assert.equal((await goals.getWeeklyGoals(me, NOW)).recorderOn, true);
});

test("the database refuses a target outside 1 to 999 and a second goal for a measure", async () => {
  const me = await newUser();
  await assert.rejects(() => prisma.weeklyGoal.create({ data: { userId: me, measure: "tasks_finished", target: 0 } }));
  await assert.rejects(() => prisma.weeklyGoal.create({ data: { userId: me, measure: "tasks_finished", target: 1000 } }));
  await prisma.weeklyGoal.create({ data: { userId: me, measure: "tasks_finished", target: 5 } });
  await assert.rejects(() => prisma.weeklyGoal.create({ data: { userId: me, measure: "tasks_finished", target: 6 } }));
});
