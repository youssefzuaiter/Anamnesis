/**
 * Editing this and the later occurrences of a series, against a real Postgres. A series is rows that share a
 * `recurrenceId`; the server works out which rows are later (from this row's old date), what the person changed, and
 * puts only that on them. Each test makes its own accounts, so nothing here can touch another test's rows.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import type { TaskPriority } from "@/lib/domain";
import type { EventInput } from "@/repositories/event-repository";
import type { TaskInput } from "@/repositories/task-repository";
import type { EventModel as Event, TaskModel as Task } from "@/generated/prisma/models";
import * as eventService from "@/services/event-service";
import * as taskService from "@/services/task-service";

const users: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `series-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0, 0);
const hm = (date: Date) => `${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const notFound = (message: string) => (error: unknown) => error instanceof AppError && error.code === "RESOURCE_NOT_FOUND" && error.message === message;
const invalid = (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR";

// ---- events: a weekly series from Monday 9 November 2026, 09:00 to 10:30, on the 9th, 16th, 23rd and 30th ----

const eventInput = (extra: Partial<EventInput> = {}): EventInput => ({
  title: "ML lecture",
  description: "Bring the notes",
  location: "Hall C",
  startTime: at(9, 9),
  endTime: at(9, 10, 30),
  projectId: null,
  ...extra,
});
const eventSeries = (userId: string, count = 4) => eventService.createRecurringEvents(userId, eventInput(), "weekly", count);
const asEventInput = (event: Event, extra: Partial<EventInput> = {}): EventInput => ({
  title: event.title,
  description: event.description,
  location: event.location,
  startTime: event.startTime,
  endTime: event.endTime,
  projectId: event.projectId,
  ...extra,
});
const eventRows = (ids: string[]) => prisma.event.findMany({ where: { id: { in: ids } }, orderBy: { startTime: "asc" } });
const without = <T extends object>(row: T, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

test("a title change reaches this and the later occurrences and leaves the earlier one byte for byte as it was", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  const ids = series.map((e) => e.id);
  const before = await eventRows(ids);

  const saved = await eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { title: "ML seminar" }));
  assert.deepEqual(saved, { changed: 3 });
  const after = await eventRows(ids);
  assert.deepEqual(after[0], before[0], "an earlier occurrence is history");
  assert.deepEqual(after.map((e) => e.title), ["ML lecture", "ML seminar", "ML seminar", "ML seminar"]);
  for (const i of [1, 2, 3]) {
    assert.deepEqual(without(after[i], "title", "updatedAt"), without(before[i], "title", "updatedAt"), `row ${i}: only the title changed`);
    // Written as exactly the picked fields, not as the row it was read as: the row's own updatedAt is not written back.
    assert.ok(after[i].updatedAt.getTime() > before[i].updatedAt.getTime(), `row ${i}: its updatedAt moved`);
  }
});

test("a new time of day is set on each later occurrence's own date, with its own length", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  const ids = series.map((e) => e.id);
  // The third occurrence was shortened on its own, to 45 minutes.
  await eventService.updateEvent(user.id, series[2].id, asEventInput(series[2], { endTime: at(23, 9, 45) }));

  const saved = await eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { startTime: at(16, 10, 30), endTime: at(16, 12) }));
  assert.deepEqual(saved, { changed: 3 });
  const rows = await eventRows(ids);
  assert.deepEqual(rows.map((e) => [hm(e.startTime), hm(e.endTime)]), [
    ["9 09:00", "9 10:30"],
    ["16 10:30", "16 12:00"],
    ["23 10:30", "23 11:15"],
    ["30 10:30", "30 12:00"],
  ]);
});

test("a new length is set on the later occurrences and their starts stay", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  const saved = await eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { endTime: at(16, 11) }));
  assert.deepEqual(saved, { changed: 3 });
  const rows = await eventRows(series.map((e) => e.id));
  assert.deepEqual(rows.map((e) => [hm(e.startTime), hm(e.endTime)]), [
    ["9 09:00", "9 10:30"],
    ["16 09:00", "16 11:00"],
    ["23 09:00", "23 11:00"],
    ["30 09:00", "30 11:00"],
  ]);
});

test("a later occurrence edited on its own keeps its own value for a field that was not changed", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  await eventService.updateEvent(user.id, series[2].id, asEventInput(series[2], { location: "Lab" }));

  await eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { title: "ML seminar" }));
  const rows = await eventRows(series.map((e) => e.id));
  assert.deepEqual(rows.map((e) => e.title), ["ML lecture", "ML seminar", "ML seminar", "ML seminar"]);
  assert.deepEqual(rows.map((e) => e.location), ["Hall C", "Hall C", "Lab", "Hall C"], "the room set on one occurrence survives a title change");
});

test("a move to another day changes this occurrence only: dates are not copied", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  const before = await eventRows(series.map((e) => e.id));
  const saved = await eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { startTime: at(17, 9), endTime: at(17, 10, 30) }));
  assert.deepEqual(saved, { changed: 1 });
  const after = await eventRows(series.map((e) => e.id));
  assert.equal(hm(after.find((e) => e.id === series[1].id)!.startTime), "17 09:00");
  for (const e of before.filter((row) => row.id !== series[1].id)) assert.deepEqual(after.find((row) => row.id === e.id), e);
});

test("the later occurrences are worked out from this one's old date, even when it is moved past them", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  const saved = await eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { title: "ML seminar", startTime: at(26, 9), endTime: at(26, 10, 30) }));
  assert.deepEqual(saved, { changed: 3 });
  const rows = await eventRows(series.map((e) => e.id));
  assert.deepEqual(rows.map((e) => e.title).sort(), ["ML lecture", "ML seminar", "ML seminar", "ML seminar"]);
  assert.equal(rows.find((e) => e.id === series[0].id)!.title, "ML lecture");
});

test("the last occurrence and a one-off are saved as only themselves", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  const before = await eventRows(series.map((e) => e.id));
  assert.deepEqual(await eventService.updateEventSeriesFrom(user.id, series[3].id, asEventInput(series[3], { title: "Last one" })), { changed: 1 });
  const after = await eventRows(series.map((e) => e.id));
  assert.equal(after[3].title, "Last one");
  for (const i of [0, 1, 2]) assert.deepEqual(after[i], before[i]);

  // A one-off has no series id: another one-off later in the calendar is not "later in its series".
  const oneOff = await eventService.createEvent(user.id, eventInput({ title: "Dentist", startTime: at(2, 9), endTime: at(2, 10) }));
  const otherOneOff = await eventService.createEvent(user.id, eventInput({ title: "Haircut", startTime: at(3, 9), endTime: at(3, 10) }));
  const otherBefore = await prisma.event.findUniqueOrThrow({ where: { id: otherOneOff.id } });
  assert.deepEqual(await eventService.updateEventSeriesFrom(user.id, oneOff.id, asEventInput(oneOff, { title: "Dentist, moved" })), { changed: 1 });
  assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: oneOff.id } })).title, "Dentist, moved");
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: otherOneOff.id } }), otherBefore);
});

test("another account's row, an imported event and an earlier occurrence that share the series id are never touched", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const series = await eventSeries(alice.id);
  const recurrenceId = series[0].recurrenceId!;
  const bobsRow = await prisma.event.create({ data: { userId: bob.id, title: "ML lecture", startTime: at(23, 9), endTime: at(23, 10, 30), recurrenceId } });
  const subscription = await prisma.calendarSubscription.create({ data: { userId: alice.id, name: "Timetable", url: "https://example.com/feed.ics" } });
  const imported = await prisma.event.create({
    data: { userId: alice.id, title: "ML lecture", startTime: at(30, 9), endTime: at(30, 10, 30), recurrenceId, subscriptionId: subscription.id, externalUid: "uid-1" },
  });
  const bobBefore = await prisma.event.findUniqueOrThrow({ where: { id: bobsRow.id } });
  const importedBefore = await prisma.event.findUniqueOrThrow({ where: { id: imported.id } });
  const firstBefore = await prisma.event.findUniqueOrThrow({ where: { id: series[0].id } });

  const saved = await eventService.updateEventSeriesFrom(alice.id, series[1].id, asEventInput(series[1], { title: "ML seminar" }));
  assert.deepEqual(saved, { changed: 3 }, "this row and her own two later rows");
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: bobsRow.id } }), bobBefore);
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: imported.id } }), importedBefore);
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: series[0].id } }), firstBefore);
});

test("an end before the start and another account's project are refused and nothing is written to any row", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const bobsProject = await prisma.project.create({ data: { userId: bob.id, title: "Bob's", category: "University" } });
  const series = await eventSeries(alice.id);
  const ids = series.map((e) => e.id);
  const before = await eventRows(ids);

  await assert.rejects(() => eventService.updateEventSeriesFrom(alice.id, series[1].id, asEventInput(series[1], { title: "x", endTime: at(16, 9) })), invalid);
  await assert.rejects(
    () => eventService.updateEventSeriesFrom(alice.id, series[1].id, asEventInput(series[1], { title: "x", projectId: bobsProject.id })),
    notFound("That project no longer exists."),
  );
  assert.deepEqual(await eventRows(ids), before);
});

test("the count is of rows that changed: a later row that already has the new value is not rewritten", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  await eventService.updateEvent(user.id, series[2].id, asEventInput(series[2], { title: "ML seminar" }));
  const alreadyThere = await prisma.event.findUniqueOrThrow({ where: { id: series[2].id } });

  const saved = await eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { title: "ML seminar" }));
  assert.deepEqual(saved, { changed: 2 }, "this row and the fourth, not the third");
  assert.deepEqual(await prisma.event.findUniqueOrThrow({ where: { id: series[2].id } }), alreadyThere, "its updatedAt did not move: it was not written");
});

test("not atomic: a later occurrence that cannot be saved stops the run, with this one and the rows before it already changed", async () => {
  const user = await newUser();
  const series = await eventSeries(user.id);
  // The fourth was stored with an end that is not after its start; it cannot take any edit.
  await prisma.event.update({ where: { id: series[3].id }, data: { endTime: at(30, 9) } });
  const fourthBefore = await prisma.event.findUniqueOrThrow({ where: { id: series[3].id } });

  await assert.rejects(() => eventService.updateEventSeriesFrom(user.id, series[1].id, asEventInput(series[1], { title: "ML seminar" })), invalid);
  const rows = await eventRows(series.map((e) => e.id));
  assert.deepEqual(rows.map((e) => e.title), ["ML lecture", "ML seminar", "ML seminar", "ML lecture"], "this row first, then the later ones in order, until one fails");
  assert.deepEqual(rows[3], fourthBefore);
});

test("another account's event and a missing one are the same refusal, and the series is unchanged", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const series = await eventSeries(alice.id);
  const ids = series.map((e) => e.id);
  const before = await eventRows(ids);
  const gone = notFound("That event no longer exists.");
  await assert.rejects(() => eventService.updateEventSeriesFrom(bob.id, series[1].id, asEventInput(series[1], { title: "x" })), gone);
  await assert.rejects(() => eventService.updateEventSeriesFrom(bob.id, randomUUID(), eventInput({ title: "x" })), gone);
  assert.deepEqual(await eventRows(ids), before);
});

// ---- tasks: a weekly series due on the 9th, 16th, 23rd and 30th at 23:59, each with a one-hour block at 09:00 ----

const taskInput = (extra: Partial<TaskInput> = {}): TaskInput => ({
  title: "Review notes",
  description: null,
  priority: "medium",
  tags: ["study"],
  dueDate: at(9, 23, 59),
  estimatedMinutes: 60,
  projectId: null,
  courseId: null,
  goalId: null,
  scheduledStart: at(9, 9),
  scheduledEnd: at(9, 10),
  ...extra,
});
const taskSeries = (userId: string, extra: Partial<TaskInput> = {}, count = 4) => taskService.createRecurringTasks(userId, taskInput(extra), "weekly", count);
const asTaskInput = (task: Task, extra: Partial<TaskInput> = {}): TaskInput => ({
  title: task.title,
  description: task.description,
  priority: task.priority as TaskPriority,
  tags: task.tags,
  dueDate: task.dueDate,
  estimatedMinutes: task.estimatedMinutes,
  projectId: task.projectId,
  courseId: task.courseId,
  goalId: task.goalId,
  scheduledStart: task.scheduledStart,
  scheduledEnd: task.scheduledEnd,
  ...extra,
});
const taskRows = (ids: string[]) => prisma.task.findMany({ where: { id: { in: ids } }, orderBy: { dueDate: "asc" } });
const SCHEDULE = ["dueDate", "scheduledStart", "scheduledEnd", "status", "completedAt", "recurrenceId", "userId", "assessmentId", "noteId"];

test("the eight fields reach the later tasks; due dates, blocks and done marks stay, and an earlier task is history", async () => {
  const user = await newUser();
  const project = await prisma.project.create({ data: { userId: user.id, title: "Thesis", category: "University" } });
  const course = await prisma.course.create({ data: { userId: user.id, code: "AIN4311", title: "Project 3", term: "2026 fall" } });
  const goal = await prisma.goal.create({ data: { userId: user.id, title: "Graduate", category: "University" } });
  const series = await taskSeries(user.id);
  const ids = series.map((t) => t.id);
  // The third one is already done.
  await prisma.task.update({ where: { id: series[2].id }, data: { status: "done", completedAt: at(20, 12) } });
  const before = await taskRows(ids);

  const saved = await taskService.updateTaskSeriesFrom(
    user.id,
    series[1].id,
    asTaskInput(series[1], {
      title: "Review the notes",
      description: "Chapters 3 and 4",
      priority: "high",
      tags: ["study", "ml"],
      estimatedMinutes: 90,
      projectId: project.id,
      courseId: course.id,
      goalId: goal.id,
    }),
  );
  assert.deepEqual(saved, { changed: 3 });
  const after = await taskRows(ids);
  assert.deepEqual(after[0], before[0], "an earlier task is history");
  for (const i of [1, 2, 3]) {
    assert.equal(after[i].title, "Review the notes");
    assert.equal(after[i].description, "Chapters 3 and 4");
    assert.equal(after[i].priority, "high");
    assert.deepEqual(after[i].tags, ["study", "ml"]);
    assert.equal(after[i].estimatedMinutes, 90);
    assert.equal(after[i].projectId, project.id);
    assert.equal(after[i].courseId, course.id);
    assert.equal(after[i].goalId, goal.id);
    for (const key of SCHEDULE) assert.deepEqual(after[i][key as keyof Task], before[i][key as keyof Task], `row ${i}: ${key} is its own`);
  }
  assert.equal(after[2].status, "done", "a later task that was done changes and stays done");
  for (const i of [1, 2, 3]) assert.ok(after[i].updatedAt.getTime() > before[i].updatedAt.getTime(), `row ${i}: its updatedAt moved`);
});

test("a trashed later task, another account's row and an earlier task that share the series id are never touched", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const series = await taskSeries(alice.id);
  const recurrenceId = series[0].recurrenceId!;
  await prisma.task.update({ where: { id: series[3].id }, data: { deletedAt: new Date() } });
  const bobs = await prisma.task.create({ data: { userId: bob.id, title: "Review notes", dueDate: at(23, 23, 59), recurrenceId } });
  const trashedBefore = await prisma.task.findUniqueOrThrow({ where: { id: series[3].id } });
  const bobBefore = await prisma.task.findUniqueOrThrow({ where: { id: bobs.id } });
  const firstBefore = await prisma.task.findUniqueOrThrow({ where: { id: series[0].id } });

  const saved = await taskService.updateTaskSeriesFrom(alice.id, series[1].id, asTaskInput(series[1], { title: "Review the notes" }));
  assert.deepEqual(saved, { changed: 2 }, "this task and the third; the fourth is in the trash");
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: series[3].id } }), trashedBefore);
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: bobs.id } }), bobBefore);
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: series[0].id } }), firstBefore);
});

test("the count is of tasks that changed: a later task that already has the new value is not rewritten", async () => {
  const user = await newUser();
  const series = await taskSeries(user.id);
  await taskService.updateTask(user.id, series[2].id, asTaskInput(series[2], { title: "Review the notes" }));
  const alreadyThere = await prisma.task.findUniqueOrThrow({ where: { id: series[2].id } });

  const saved = await taskService.updateTaskSeriesFrom(user.id, series[1].id, asTaskInput(series[1], { title: "Review the notes" }));
  assert.deepEqual(saved, { changed: 2 }, "this task and the fourth, not the third");
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: series[2].id } }), alreadyThere, "its updatedAt did not move: it was not written");
});

test("a one-off task is saved as only itself, and another one-off due later is not touched", async () => {
  const user = await newUser();
  const one = await taskService.createTask(user.id, taskInput({ title: "Hand in form", dueDate: at(2, 23, 59), scheduledStart: null, scheduledEnd: null }));
  const other = await taskService.createTask(user.id, taskInput({ title: "Pay fees", dueDate: at(3, 23, 59), scheduledStart: null, scheduledEnd: null }));
  const otherBefore = await prisma.task.findUniqueOrThrow({ where: { id: other.id } });
  assert.deepEqual(await taskService.updateTaskSeriesFrom(user.id, one.id, asTaskInput(one, { title: "Hand in the form" })), { changed: 1 });
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: one.id } })).title, "Hand in the form");
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: other.id } }), otherBefore);
});

test("a series task with no due date, and a change that changes nothing, are saved as only themselves", async () => {
  const user = await newUser();
  const series = await taskSeries(user.id);
  const ids = series.map((t) => t.id);
  await prisma.task.update({ where: { id: series[1].id }, data: { dueDate: null } });
  const undated = await prisma.task.findUniqueOrThrow({ where: { id: series[1].id } });
  const before = await taskRows(ids.filter((id) => id !== series[1].id));

  assert.deepEqual(await taskService.updateTaskSeriesFrom(user.id, series[1].id, asTaskInput(undated, { title: "Review the notes" })), { changed: 1 });
  assert.deepEqual(await taskRows(ids.filter((id) => id !== series[1].id)), before, "with no due date there is no later to order by");

  const other = await taskSeries(user.id);
  assert.deepEqual(await taskService.updateTaskSeriesFrom(user.id, other[1].id, asTaskInput(other[1])), { changed: 1 }, "nothing changed, so nothing is copied");
});

test("another account's course or goal is refused and nothing is written to any task", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const bobsCourse = await prisma.course.create({ data: { userId: bob.id, code: "X1", title: "Bob's", term: "2026 fall" } });
  const bobsGoal = await prisma.goal.create({ data: { userId: bob.id, title: "Bob's", category: "University" } });
  const series = await taskSeries(alice.id);
  const ids = series.map((t) => t.id);
  const before = await taskRows(ids);
  await assert.rejects(() => taskService.updateTaskSeriesFrom(alice.id, series[1].id, asTaskInput(series[1], { title: "x", courseId: bobsCourse.id })), notFound("That course no longer exists."));
  await assert.rejects(() => taskService.updateTaskSeriesFrom(alice.id, series[1].id, asTaskInput(series[1], { title: "x", goalId: bobsGoal.id })), notFound("That goal no longer exists."));
  assert.deepEqual(await taskRows(ids), before);
});

test("moving the series to another project recalculates both projects' progress", async () => {
  const user = await newUser();
  const from = await prisma.project.create({ data: { userId: user.id, title: "Old", category: "University" } });
  const to = await prisma.project.create({ data: { userId: user.id, title: "New", category: "University" } });
  const series = await taskSeries(user.id, { projectId: from.id }, 3);
  await taskService.setTaskStatus(user.id, series[2].id, "done");
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: from.id } })).progress, 33);

  await taskService.updateTaskSeriesFrom(user.id, series[0].id, asTaskInput(series[0], { projectId: to.id }));
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: from.id } })).progress, 0, "nothing is left in the old project");
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: to.id } })).progress, 33, "one of three is done in the new one");
});

test("not atomic: a later task that cannot be saved stops the run, with this one and the rows before it already changed", async () => {
  const user = await newUser();
  const series = await taskSeries(user.id);
  await prisma.task.update({ where: { id: series[3].id }, data: { scheduledEnd: at(30, 8) } });
  const fourthBefore = await prisma.task.findUniqueOrThrow({ where: { id: series[3].id } });

  await assert.rejects(() => taskService.updateTaskSeriesFrom(user.id, series[1].id, asTaskInput(series[1], { title: "Review the notes" })), invalid);
  const rows = await taskRows(series.map((t) => t.id));
  assert.deepEqual(rows.map((t) => t.title), ["Review notes", "Review the notes", "Review the notes", "Review notes"]);
  assert.deepEqual(rows[3], fourthBefore);
});

test("a task's later set is worked out from its old due date, and a missing or foreign id is one refusal", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const series = await taskSeries(alice.id);
  const ids = series.map((t) => t.id);
  const saved = await taskService.updateTaskSeriesFrom(alice.id, series[1].id, asTaskInput(series[1], { title: "Review the notes", dueDate: at(26, 23, 59) }));
  assert.deepEqual(saved, { changed: 3 });
  assert.deepEqual((await taskRows(ids)).map((t) => t.title).sort(), ["Review notes", "Review the notes", "Review the notes", "Review the notes"]);

  const before = await taskRows(ids);
  const gone = notFound("That task no longer exists.");
  await assert.rejects(() => taskService.updateTaskSeriesFrom(bob.id, series[1].id, taskInput({ title: "x" })), gone);
  await assert.rejects(() => taskService.updateTaskSeriesFrom(bob.id, randomUUID(), taskInput({ title: "x" })), gone);
  assert.deepEqual(await taskRows(ids), before);
});
