/**
 * The daily note and Shut down day against a real Postgres, DB-only like the
 * rest of this tier. The checks that matter here are the ones a pure unit test
 * cannot make: one note per day and per account, and a client-sent task id
 * never moving anyone else's task.
 *
 * Each test makes its own accounts so one test's tasks cannot leak into
 * another's proposal.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import {
  applyShutdown,
  findTodayNote,
  openTodayNote,
  proposeShutdown,
} from "@/services/daily-service";

const NOW = new Date(2026, 9, 28, 18, 0); // Wed 28 Oct 2026, 18:00 local
const DAY = "2026-10-28"; // the day a panel shown at NOW was proposed for
/** A local time on the day `dayOffset` days from 28 Oct. */
const at = (hour: number, minute: number, dayOffset = 0) =>
  new Date(2026, 9, 28 + dayOffset, hour, minute);

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `daily-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

type TaskFields = {
  title?: string;
  status?: string;
  priority?: string;
  tags?: string[];
  dueDate?: Date | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
};

function addTask(userId: string, over: TaskFields = {}) {
  return prisma.task.create({
    data: {
      userId,
      title: "A task",
      status: "todo",
      priority: "medium",
      estimatedMinutes: 30,
      ...over,
    },
  });
}

const refusedAsValidation = (error: unknown) =>
  error instanceof AppError && error.code === "VALIDATION_ERROR";

test("opening today's note twice gives one note, with the day's schedule and tasks in it", async () => {
  const a = await newUser();
  await prisma.event.create({
    data: { userId: a.id, title: "ML midterm", startTime: at(9, 0), endTime: at(11, 0), location: "Hall C" },
  });
  await addTask(a.id, { title: "Draft related-work section", priority: "high", dueDate: at(23, 59) });

  const first = await openTodayNote(a.id, NOW);
  assert.equal(first.created, true);

  const note = await prisma.note.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(note.title, "2026-10-28");
  assert.deepEqual(note.tags, ["daily"]);
  assert.ok(note.content.includes("- 09:00–11:00 ML midterm, Hall C"), note.content);
  assert.ok(note.content.includes("- [ ] Draft related-work section (high, due today)"), note.content);
  assert.ok(note.content.endsWith("## Notes\n"));

  const second = await openTodayNote(a.id, NOW);
  assert.deepEqual(second, { id: first.id, created: false });
  assert.equal(await prisma.note.count({ where: { userId: a.id, title: "2026-10-28" } }), 1);
  assert.equal((await findTodayNote(a.id, NOW))?.id, first.id);
});

test("another account never shares the note, and never sees the first account's titles", async () => {
  const a = await newUser();
  const b = await newUser();
  await addTask(a.id, { title: "Only A knows this", dueDate: at(12, 0) });
  const forA = await openTodayNote(a.id, NOW);

  assert.equal(await findTodayNote(b.id, NOW), null);
  const forB = await openTodayNote(b.id, NOW);
  assert.notEqual(forB.id, forA.id);
  const noteB = await prisma.note.findUniqueOrThrow({ where: { id: forB.id } });
  assert.ok(!noteB.content.includes("Only A knows this"));
  assert.equal(noteB.userId, b.id);
});

test("a deleted daily note is not found, and a plain note with the date but no tag does not count", async () => {
  const a = await newUser();
  await prisma.note.create({ data: { userId: a.id, title: "2026-10-28", content: "just a note", tags: [] } });

  const first = await openTodayNote(a.id, NOW);
  assert.equal(first.created, true); // the untagged note did not stop it

  await prisma.note.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
  assert.equal(await findTodayNote(a.id, NOW), null);
  const again = await openTodayNote(a.id, NOW);
  assert.equal(again.created, true);
  assert.notEqual(again.id, first.id);
});

test("the proposal holds only the caller's open, dated tasks due today or overdue", async () => {
  const a = await newUser();
  const b = await newUser();
  await addTask(a.id, { title: "A today", dueDate: at(9, 0) });
  await addTask(a.id, { title: "A overdue", dueDate: at(9, 0, -2) });
  await addTask(a.id, { title: "A done", dueDate: at(9, 0), status: "done" });
  await addTask(a.id, { title: "A undated" });
  await addTask(a.id, { title: "A tomorrow", dueDate: at(9, 0, 1) });
  const bTask = await addTask(b.id, { title: "B today", dueDate: at(9, 0) });

  const plan = await proposeShutdown(a.id, NOW);
  assert.deepEqual(plan.dueToday.map((t) => t.title), ["A today"]);
  assert.deepEqual(plan.overdue.map((t) => t.title), ["A overdue"]);
  assert.equal(`${plan.tomorrow.getFullYear()}-${plan.tomorrow.getMonth() + 1}-${plan.tomorrow.getDate()}`, "2026-10-29");

  // Another account's id sent from the browser is ignored, and moves nothing.
  await assert.rejects(() => applyShutdown(a.id, NOW, [bTask.id], DAY), refusedAsValidation);
  const after = await prisma.task.findUniqueOrThrow({ where: { id: bTask.id } });
  assert.deepEqual(after.dueDate, at(9, 0));
});

test("applying moves due dates to tomorrow at the same time and clears only a block that starts today", async () => {
  const a = await newUser();
  const dueToday = await addTask(a.id, {
    title: "Due today", priority: "high", tags: ["x"], dueDate: at(9, 30),
    scheduledStart: at(14, 0), scheduledEnd: at(15, 0),
  });
  const overdue = await addTask(a.id, {
    title: "Overdue", dueDate: at(9, 30, -2),
    scheduledStart: at(10, 0, 1), scheduledEnd: at(11, 0, 1),
  });

  const result = await applyShutdown(a.id, NOW, [dueToday.id, overdue.id], DAY);
  assert.equal(result.moved, 2);

  const first = await prisma.task.findUniqueOrThrow({ where: { id: dueToday.id } });
  assert.deepEqual(first.dueDate, at(9, 30, 1));
  assert.equal(first.scheduledStart, null);
  assert.equal(first.scheduledEnd, null);
  assert.equal(first.title, "Due today");
  assert.equal(first.priority, "high");
  assert.deepEqual(first.tags, ["x"]);

  const second = await prisma.task.findUniqueOrThrow({ where: { id: overdue.id } });
  assert.deepEqual(second.dueDate, at(9, 30, 1)); // tomorrow, not the day after its old date
  assert.deepEqual(second.scheduledStart, at(10, 0, 1)); // a block on another day stays
  assert.deepEqual(second.scheduledEnd, at(11, 0, 1)); // with its own end, not a default one
});

test("an overdue task is left alone unless it is requested", async () => {
  const a = await newUser();
  const dueToday = await addTask(a.id, { title: "Due today", dueDate: at(9, 0) });
  const overdue = await addTask(a.id, { title: "Overdue", dueDate: at(9, 0, -3) });

  await applyShutdown(a.id, NOW, [dueToday.id], DAY);
  const left = await prisma.task.findUniqueOrThrow({ where: { id: overdue.id } });
  assert.deepEqual(left.dueDate, at(9, 0, -3));
});

test("shutting down twice moves nothing the second time", async () => {
  const a = await newUser();
  const task = await addTask(a.id, { title: "Due today", dueDate: at(9, 0) });

  await applyShutdown(a.id, NOW, [task.id], DAY);
  await assert.rejects(() => applyShutdown(a.id, NOW, [task.id], DAY), refusedAsValidation);
  const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.deepEqual(row.dueDate, at(9, 0, 1));
});

test("applying after midnight is refused, so nothing lands a day later than the panel said", async () => {
  const a = await newUser();
  const task = await addTask(a.id, { title: "Due today", dueDate: at(9, 0) });
  const afterMidnight = at(0, 5, 1); // 00:05 on 29 Oct; the panel was proposed on the 28th

  await assert.rejects(
    () => applyShutdown(a.id, afterMidnight, [task.id], DAY),
    refusedAsValidation,
  );
  const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.deepEqual(row.dueDate, at(9, 0));
});
