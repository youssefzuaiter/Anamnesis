/**
 * The numbers behind /stats (ROADMAP item 39), against a real Postgres: only the caller's tasks, review lines and study sessions,
 * counted by local day, with a streak and eight weeks. Study time is only there while the person has the recorder on.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getStats } from "@/services/stats-service";
import { dayKey } from "@/lib/study-stats";

const made: string[] = [];
async function newUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: `stats-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const NOW = new Date(2026, 10, 15, 14, 0); // Sunday 15 November 2026
const day = (d: number, h = 10) => new Date(2026, 10, d, h, 0);
const done = (userId: string, completedAt: Date | null, extra: Record<string, unknown> = {}) =>
  prisma.task.create({ data: { userId, title: "T", status: completedAt ? "done" : "todo", priority: "low", tags: [], completedAt, ...extra } });
const review = (userId: string, reviewedAt: Date) => prisma.cardReview.create({ data: { userId, reviewedAt, grade: "good" } });
const study = (userId: string, recordedAt: Date, seconds: number) => prisma.studySession.create({ data: { userId, recordedAt, seconds } });

test("a new account has nothing: no streak, empty weeks, the recorder off, no card history", async () => {
  const me = await newUser();
  const stats = await getStats(me, NOW);
  assert.deepEqual(stats.streak, { current: 0, longest: 0, todayActive: false });
  assert.equal(stats.weeks.length, 8);
  assert.equal(stats.weeks.every((week) => week.tasks + week.cards + week.studySeconds === 0), true);
  assert.equal(stats.days.length, 7);
  assert.equal(stats.recorderOn, false);
  assert.equal(stats.cardLogSince, null);
  assert.equal(stats.hasActivity, false);
});

test("tasks finished, cards reviewed and study recorded make the weeks and the streak", async () => {
  const me = await newUser();
  await prisma.userProfile.create({ data: { userId: me, timerSessionsEnabled: true } });
  for (const d of [12, 13, 14, 15]) await done(me, day(d));
  await done(me, day(15, 16));
  await done(me, null); // an open task is nothing
  await review(me, day(14));
  await review(me, day(14, 18));
  await review(me, day(3));
  await study(me, day(11), 1800);
  await study(me, day(15), 90);
  await study(me, day(2), 30);

  const stats = await getStats(me, NOW);
  assert.deepEqual(stats.streak, { current: 5, longest: 5, todayActive: true }, "11 to 15 November, every day counted by something");
  assert.deepEqual(stats.days.map((d) => d.active), [false, false, true, true, true, true, true], "Monday 9 to Sunday 15 November");
  const thisWeek = stats.weeks[7];
  assert.equal(dayKey(thisWeek.start), "2026-11-09");
  assert.deepEqual([thisWeek.tasks, thisWeek.cards, thisWeek.studySeconds], [5, 2, 1890]);
  assert.deepEqual([stats.weeks[6].cards, stats.weeks[6].tasks, stats.weeks[6].studySeconds], [1, 0, 30]);
  assert.equal(stats.recorderOn, true);
  assert.equal(stats.hasActivity, true);
  assert.equal(dayKey(stats.cardLogSince!), "2026-11-03");
});

test("a task that was finished and then deleted still counts for the day it was finished", async () => {
  const me = await newUser();
  await done(me, day(15), { deletedAt: new Date() });
  assert.equal((await getStats(me, NOW)).streak.current, 1);
});

test("another account's tasks, review lines and study sessions are never counted", async () => {
  const me = await newUser();
  const other = await newUser();
  for (const d of [13, 14, 15]) {
    await done(other, day(d));
    await review(other, day(d));
    await study(other, day(d), 3600);
  }
  const stats = await getStats(me, NOW);
  assert.deepEqual(stats.streak, { current: 0, longest: 0, todayActive: false });
  assert.equal(stats.weeks[7].tasks + stats.weeks[7].cards + stats.weeks[7].studySeconds, 0);
  assert.equal(stats.cardLogSince, null);
  assert.equal(stats.hasActivity, false);
});

test("a streak longer than the eight weeks is still found, and activity in the future is not counted", async () => {
  const me = await newUser();
  for (let i = 0; i < 90; i++) await done(me, new Date(2026, 10, 15 - i, 9));
  await done(me, new Date(2026, 10, 16, 9)); // tomorrow
  const stats = await getStats(me, NOW);
  assert.equal(stats.streak.current, 90);
  assert.equal(stats.streak.longest, 90);
  assert.equal(stats.weeks[7].tasks, 7, "the week so far: Monday 9 to Sunday 15 November, not tomorrow");
});

test("a day with only a few seconds of study does not count, a minute does", async () => {
  const me = await newUser();
  await study(me, day(14), 59);
  await study(me, day(15), 60);
  const stats = await getStats(me, NOW);
  assert.deepEqual(stats.days.slice(-2).map((d) => d.active), [false, true]);
  assert.equal(stats.streak.current, 1);
});
