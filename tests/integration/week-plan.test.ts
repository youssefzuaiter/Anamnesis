/** Plan my week (ROADMAP item 51) against a real Postgres: only the caller's own open, untimed tasks; booked time respected; nothing written by a proposal; apply compares task and start. */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { applyWeek, proposeWeek } from "@/services/week-plan-service";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `week-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const NOW = new Date(2026, 10, 22, 20);
const WEEK = "2026-11-23";
const at = (d: number, h: number, m = 0) => new Date(2026, 10, 23 + d, h, m);
const task = (userId: string, title: string, over: Record<string, unknown> = {}) => prisma.task.create({ data: { userId, title, priority: "medium", estimatedMinutes: 60, ...over } });
const reject = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

test("a proposal is the caller's open, untimed tasks in the free time of the week, and writes nothing", async () => {
  const me = await newUser();
  const them = await newUser();
  const a = await task(me, "Mine A", { priority: "high" });
  await task(me, "Mine B");
  await task(me, "Done", { status: "done" });
  await task(me, "Trashed", { deletedAt: new Date() });
  await task(me, "Already planned", { scheduledStart: at(0, 9), scheduledEnd: at(0, 10) });
  await task(them, "Theirs");
  await prisma.event.create({ data: { userId: me, title: "Lecture", startTime: at(0, 9), endTime: at(0, 12) } });

  const p = await proposeWeek(me, WEEK, NOW);
  assert.equal(p.weekStart, "2026-11-23");
  assert.deepEqual(p.blocks.map((b) => b.title).sort(), ["Mine A", "Mine B"]);
  assert.equal(p.days.length, 7);
  assert.deepEqual(p.booked.map((b) => [b.title, b.kind]).sort(), [["Already planned", "planned"], ["Lecture", "event"]]);
  const first = p.blocks.find((b) => b.taskId === a.id)!;
  assert.ok(new Date(first.start).getTime() >= at(0, 12).getTime() || new Date(first.start).getDate() !== 23, "never over the lecture or the planned block");
  for (const b of p.blocks) assert.ok(!(new Date(b.start) < at(0, 12) && new Date(b.end) > at(0, 9) && new Date(b.start).getDate() === 23));
  assert.equal(await prisma.task.count({ where: { userId: me, scheduledStart: { not: null } } }), 1, "only the one that was already planned");
});

test("a week argument that is not a week is refused", async () => {
  const me = await newUser();
  for (const bad of ["", "tomorrow", "2026-02-30", "x".repeat(500)]) await reject(proposeWeek(me, bad, NOW), "VALIDATION_ERROR");
});

test("applying schedules the blocks that still match, at their proposed starts, and changes nothing else on the task", async () => {
  const me = await newUser();
  const t = await task(me, "Essay", { priority: "high", estimatedMinutes: 90, description: "keep me", dueDate: at(4, 23, 59) });
  await task(me, "Reading");
  const p = await proposeWeek(me, WEEK, NOW);
  const picks = p.blocks.map((b) => ({ taskId: b.taskId, start: b.start }));
  assert.deepEqual(await applyWeek(me, WEEK, picks, NOW), { scheduled: 2, requested: 2 });
  const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(after.scheduledStart?.toISOString(), p.blocks.find((b) => b.taskId === t.id)!.start);
  assert.deepEqual([after.title, after.description, after.priority, after.estimatedMinutes, after.dueDate?.getTime(), after.status], ["Essay", "keep me", "high", 90, at(4, 23, 59).getTime(), t.status]);
});

test("a block whose time no longer matches, or whose task is another account's, is not applied and is counted", async () => {
  const me = await newUser();
  const them = await newUser();
  const mine = await task(me, "Mine");
  const theirs = await task(them, "Theirs");
  const p = await proposeWeek(me, WEEK, NOW);
  const real = p.blocks[0];
  const stale = new Date(new Date(real.start).getTime() + 30 * 60_000).toISOString();
  await reject(applyWeek(me, WEEK, [{ taskId: mine.id, start: stale }], NOW), "VALIDATION_ERROR");
  const r = await applyWeek(me, WEEK, [{ taskId: mine.id, start: real.start }, { taskId: theirs.id, start: real.start }, { taskId: randomUUID(), start: real.start }], NOW);
  assert.deepEqual(r, { scheduled: 1, requested: 3 });
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: theirs.id } })).scheduledStart, null);
});

test("applying twice schedules once: the second finds nothing that still matches", async () => {
  const me = await newUser();
  await task(me, "Once");
  const p = await proposeWeek(me, WEEK, NOW);
  const picks = p.blocks.map((b) => ({ taskId: b.taskId, start: b.start }));
  await applyWeek(me, WEEK, picks, NOW);
  await reject(applyWeek(me, WEEK, picks, NOW), "VALIDATION_ERROR");
});

test("a task changed after the proposal (booked since) drops out when the calendar no longer has room", async () => {
  const me = await newUser();
  await task(me, "Squeezed", { estimatedMinutes: 120 });
  const p = await proposeWeek(me, WEEK, NOW);
  const block = p.blocks[0];
  // The whole day of that block is booked afterwards.
  const d = new Date(block.start);
  await prisma.event.create({ data: { userId: me, title: "Suddenly busy", startTime: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0), endTime: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0) } });
  await reject(applyWeek(me, WEEK, [{ taskId: block.taskId, start: block.start }], NOW), "VALIDATION_ERROR");
});

test("what did not fit is reported with a reason", async () => {
  const me = await newUser();
  await task(me, "Too long", { estimatedMinutes: 900 });
  await task(me, "Due Monday", { dueDate: at(0, 23, 59), estimatedMinutes: 60 });
  await prisma.event.create({ data: { userId: me, title: "All Monday", startTime: at(0, 0), endTime: at(1, 0) } });
  const p = await proposeWeek(me, WEEK, NOW);
  assert.deepEqual(p.unplaced.map((u) => [u.title, u.reason]).sort(), [["Due Monday", "before-due"], ["Too long", "no-room"]]);
});
