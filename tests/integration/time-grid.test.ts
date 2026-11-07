/**
 * Moving an event or a task block, against a real Postgres. The browser sends a start and an end as epoch
 * milliseconds, so the server holds the rules: whose it is, whether it can be moved at all (an imported event
 * cannot: its feed would put it back), what the range may be, and that nothing but the times change. Each test
 * makes its own accounts.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { getGoalTaskTotals } from "@/repositories/goal-repository";
import * as eventRepository from "@/repositories/event-repository";
import * as eventService from "@/services/event-service";
import * as taskService from "@/services/task-service";

const users: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `grid-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0, 0);
const makeEvent = (userId: string, extra: Record<string, unknown> = {}) =>
  prisma.event.create({ data: { userId, title: "Lecture", startTime: at(9, 9), endTime: at(9, 10, 30), ...extra } });
const makeTask = (userId: string, extra: Record<string, unknown> = {}) => prisma.task.create({ data: { userId, title: "A task", ...extra } });
const eventNotFound = (error: unknown) => error instanceof AppError && error.code === "RESOURCE_NOT_FOUND" && error.message === "That event no longer exists.";
const taskNotFound = (error: unknown) => error instanceof AppError && error.code === "RESOURCE_NOT_FOUND" && error.message === "That task no longer exists.";
const invalid = (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR";

test("moving an event changes its two times and nothing else, and leaves the rest of its series alone", async () => {
  const user = await newUser();
  const project = await prisma.project.create({ data: { userId: user.id, title: "P", category: "University" } });
  const series = randomUUID();
  const first = await makeEvent(user.id, { description: "Bring the notes", location: "Hall C", projectId: project.id, recurrenceId: series });
  const second = await makeEvent(user.id, { startTime: at(16, 9), endTime: at(16, 10, 30), recurrenceId: series });
  const beforeSecond = await prisma.event.findUniqueOrThrow({ where: { id: second.id } });

  const moved = await eventService.rescheduleEvent(user.id, first.id, at(9, 14, 15), at(9, 15, 45));
  assert.equal(moved.startTime.getTime(), at(9, 14, 15).getTime());
  assert.equal(moved.endTime.getTime(), at(9, 15, 45).getTime());
  const row = await prisma.event.findUniqueOrThrow({ where: { id: first.id } });
  for (const field of ["title", "description", "location", "projectId", "courseId", "recurrenceId", "subscriptionId", "externalUid", "userId"] as const) {
    assert.equal(row[field], first[field], field);
  }
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: second.id } }), beforeSecond, "another occurrence of the series is untouched");
});

test("an imported event cannot be moved here, and is left byte for byte as it was", async () => {
  const user = await newUser();
  const subscription = await prisma.calendarSubscription.create({ data: { userId: user.id, name: "Timetable", url: "https://example.com/feed.ics" } });
  const imported = await makeEvent(user.id, { subscriptionId: subscription.id, externalUid: "uid-1" });
  const before = await prisma.event.findUniqueOrThrow({ where: { id: imported.id } });

  await assert.rejects(
    () => eventService.rescheduleEvent(user.id, imported.id, at(9, 14), at(9, 15)),
    (error: unknown) => invalid(error) && /imported/i.test((error as AppError).message) && /calendar it came from/i.test((error as AppError).message),
  );
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: imported.id } }), before);
  // The repository's own write refuses it too, whatever the service did.
  assert.equal(await eventRepository.setEventTimes(user.id, imported.id, at(9, 14), at(9, 15)), null);
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: imported.id } }), before);
});

test("another account's event and a missing one are refused the same way, and nothing changes", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const aliceEvent = await makeEvent(alice.id);
  const before = await prisma.event.findUniqueOrThrow({ where: { id: aliceEvent.id } });
  await assert.rejects(() => eventService.rescheduleEvent(bob.id, aliceEvent.id, at(9, 14), at(9, 15)), eventNotFound);
  await assert.rejects(() => eventService.rescheduleEvent(bob.id, randomUUID(), at(9, 14), at(9, 15)), eventNotFound);
  assert.equal(await eventRepository.setEventTimes(bob.id, aliceEvent.id, at(9, 14), at(9, 15)), null);
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: aliceEvent.id } }), before);
});

test("a range that is not a sane time is refused before anything is written", async () => {
  const user = await newUser();
  const event = await makeEvent(user.id);
  const task = await makeTask(user.id, { scheduledStart: at(9, 9), scheduledEnd: at(9, 10) });
  const eventBefore = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
  const taskBefore = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  const hours = (n: number) => n * 3_600_000;
  const cases: [string, Date, Date][] = [
    ["the end is the start", at(9, 14), at(9, 14)],
    ["the end is before the start", at(9, 15), at(9, 14)],
    ["thirty hours", at(9, 9), new Date(at(9, 9).getTime() + hours(30))],
    ["the year 3000", new Date(Date.UTC(3000, 0, 1)), new Date(Date.UTC(3000, 0, 1) + hours(1))],
    ["before 2000", new Date(Date.UTC(1999, 0, 1)), new Date(Date.UTC(1999, 0, 1) + hours(1))],
    ["not a number", new Date(Number.NaN), at(9, 15)],
  ];
  for (const [label, start, end] of cases) {
    await assert.rejects(() => eventService.rescheduleEvent(user.id, event.id, start, end), invalid, `event: ${label}`);
    await assert.rejects(() => taskService.setTaskBlock(user.id, task.id, start, end), invalid, `block: ${label}`);
  }
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }), eventBefore);
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), taskBefore);
  // A range of exactly a day is allowed.
  const day = await eventService.rescheduleEvent(user.id, event.id, at(9, 0), at(10, 0));
  assert.equal(day.endTime.getTime() - day.startTime.getTime(), 24 * 3_600_000);
});

test("moving a task's block changes the block and nothing else of the task, its due date included", async () => {
  const user = await newUser();
  const goal = await prisma.goal.create({ data: { userId: user.id, title: "G", category: "University" } });
  const project = await prisma.project.create({ data: { userId: user.id, title: "P", category: "University", goalId: goal.id } });
  const task = await makeTask(user.id, {
    description: "Chapters 3 and 4",
    priority: "high",
    tags: ["study", "ml"],
    dueDate: at(14, 23, 59),
    estimatedMinutes: 45,
    projectId: project.id,
    goalId: goal.id,
    status: "in_progress",
    scheduledStart: at(9, 9),
    scheduledEnd: at(9, 10),
  });
  const totalsBefore = await getGoalTaskTotals(user.id, goal.id);
  const progressBefore = (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).progress;

  const moved = await taskService.setTaskBlock(user.id, task.id, at(11, 13, 30), at(11, 15, 15));
  assert.equal(moved.scheduledStart?.getTime(), at(11, 13, 30).getTime());
  assert.equal(moved.scheduledEnd?.getTime(), at(11, 15, 15).getTime());
  const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  for (const field of ["title", "description", "priority", "status", "estimatedMinutes", "projectId", "goalId", "courseId", "userId", "recurrenceId", "completedAt"] as const) {
    assert.equal(row[field], task[field], field);
  }
  assert.deepEqual(row.tags, ["study", "ml"]);
  assert.equal(row.dueDate?.getTime(), at(14, 23, 59).getTime(), "a block is when it is planned, the due date is when it is owed");
  assert.deepEqual(await getGoalTaskTotals(user.id, goal.id), totalsBefore);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).progress, progressBefore);
});

test("another account's task, a trashed one and a missing one are refused alike, and nothing changes", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const aliceTask = await makeTask(alice.id, { scheduledStart: at(9, 9), scheduledEnd: at(9, 10) });
  const trashed = await makeTask(bob.id, { scheduledStart: at(9, 9), scheduledEnd: at(9, 10), deletedAt: new Date() });
  const before = await prisma.task.findUniqueOrThrow({ where: { id: aliceTask.id } });
  const trashedBefore = await prisma.task.findUniqueOrThrow({ where: { id: trashed.id } });
  await assert.rejects(() => taskService.setTaskBlock(bob.id, aliceTask.id, at(9, 14), at(9, 15)), taskNotFound);
  await assert.rejects(() => taskService.setTaskBlock(bob.id, randomUUID(), at(9, 14), at(9, 15)), taskNotFound);
  await assert.rejects(() => taskService.setTaskBlock(bob.id, trashed.id, at(9, 14), at(9, 15)), taskNotFound);
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: aliceTask.id } }), before);
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: trashed.id } }), trashedBefore);
});

test("the block of a finished task can still be moved, and it stays finished", async () => {
  const user = await newUser();
  const done = await makeTask(user.id, { status: "done", completedAt: at(8, 12), scheduledStart: at(9, 9), scheduledEnd: at(9, 10) });
  const moved = await taskService.setTaskBlock(user.id, done.id, at(10, 9), at(10, 10));
  assert.equal(moved.status, "done");
  assert.equal(moved.completedAt?.getTime(), at(8, 12).getTime());
  assert.equal(moved.scheduledStart?.getTime(), at(10, 9).getTime());
});

test("scheduling a task at a time gives it a block as long as its estimate", async () => {
  const user = await newUser();
  const task = await makeTask(user.id, { estimatedMinutes: 45 });
  const scheduled = await taskService.scheduleTask(user.id, task.id, at(9, 13, 30));
  assert.equal(scheduled.scheduledStart?.getTime(), at(9, 13, 30).getTime());
  assert.equal(scheduled.scheduledEnd?.getTime(), at(9, 14, 15).getTime());
  assert.equal(scheduled.dueDate, null, "a block does not give the task a due date");
});
