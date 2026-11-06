/**
 * What the project board relies on, against a real Postgres. `in_progress` has been a valid status since the
 * start but nothing in the app set it until the board; these tests hold the behaviour the board now depends on:
 * the finished time follows the status, no progress figure moves for `in_progress`, a task counts once, and a task
 * that is not yours (or not there, or in the trash) is refused identically. Each test makes its own accounts.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { getGoalTaskTotals } from "@/repositories/goal-repository";
import { countOpenTasks } from "@/repositories/task-repository";
import * as taskService from "@/services/task-service";

const users: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `board-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const makeProject = (userId: string, extra: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { userId, title: "A project", category: "University", ...extra } });
const makeTask = (userId: string, extra: Record<string, unknown> = {}) => prisma.task.create({ data: { userId, title: "A task", ...extra } });
const progressOf = async (projectId: string) => (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).progress;
const refused = (error: unknown) => error instanceof AppError && error.code === "RESOURCE_NOT_FOUND" && error.message === "That task no longer exists.";

test("a task walks through every column: the finished time follows the status and in_progress moves no progress", async () => {
  const user = await newUser();
  const project = await makeProject(user.id);
  const task = await makeTask(user.id, { projectId: project.id });
  const other = await makeTask(user.id, { projectId: project.id });

  let moved = await taskService.setTaskStatus(user.id, task.id, "in_progress");
  assert.equal(moved.status, "in_progress");
  assert.equal(moved.completedAt, null);
  assert.equal(await progressOf(project.id), 0, "in progress is not done");

  moved = await taskService.setTaskStatus(user.id, task.id, "done");
  assert.ok(moved.completedAt instanceof Date);
  assert.equal(await progressOf(project.id), 50, "one of two tasks: a raw count");

  moved = await taskService.setTaskStatus(user.id, task.id, "in_progress");
  assert.equal(moved.completedAt, null, "a finished task moved back is not finished");
  assert.equal(await progressOf(project.id), 0);

  moved = await taskService.setTaskStatus(user.id, task.id, "todo");
  assert.equal(moved.status, "todo");
  assert.equal(moved.completedAt, null);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: other.id } })).status, "todo", "the other task is untouched");
});

test("a task reached by a goal both directly and through its project is counted once in every column", async () => {
  const user = await newUser();
  const goal = await prisma.goal.create({ data: { userId: user.id, title: "A goal", category: "University" } });
  const project = await makeProject(user.id, { goalId: goal.id });
  const task = await makeTask(user.id, { projectId: project.id, goalId: goal.id });

  assert.deepEqual(await getGoalTaskTotals(user.id, goal.id), { done: 0, total: 1 });
  await taskService.setTaskStatus(user.id, task.id, "in_progress");
  assert.deepEqual(await getGoalTaskTotals(user.id, goal.id), { done: 0, total: 1 });
  await taskService.setTaskStatus(user.id, task.id, "done");
  assert.deepEqual(await getGoalTaskTotals(user.id, goal.id), { done: 1, total: 1 });
  assert.equal((await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })).progress, 100);
  await taskService.setTaskStatus(user.id, task.id, "in_progress");
  assert.deepEqual(await getGoalTaskTotals(user.id, goal.id), { done: 0, total: 1 });
});

test("in progress is open: it is counted with the open tasks and done is not", async () => {
  const user = await newUser();
  await makeTask(user.id);
  await makeTask(user.id, { status: "in_progress" });
  await makeTask(user.id, { status: "done", completedAt: new Date() });
  assert.equal(await countOpenTasks(user.id), 2);
});

test("a task of another account, a missing one and one in the trash are refused the same way, and nothing changes", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const aliceTask = await makeTask(alice.id, { status: "in_progress" });
  const trashed = await makeTask(bob.id, { deletedAt: new Date() });
  const before = await prisma.task.findUniqueOrThrow({ where: { id: aliceTask.id } });
  const trashedBefore = await prisma.task.findUniqueOrThrow({ where: { id: trashed.id } });

  await assert.rejects(() => taskService.setTaskStatus(bob.id, aliceTask.id, "done"), refused);
  await assert.rejects(() => taskService.setTaskStatus(bob.id, randomUUID(), "done"), refused);
  await assert.rejects(() => taskService.setTaskStatus(bob.id, trashed.id, "done"), refused);

  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: aliceTask.id } }), before, "the other account's task is byte for byte the same");
  assert.deepEqual(await prisma.task.findUniqueOrThrow({ where: { id: trashed.id } }), trashedBefore, "a task in the trash is not touched");
});

test("moving a task to the status it already has is not an error and moves no progress", async () => {
  const user = await newUser();
  const project = await makeProject(user.id);
  const task = await makeTask(user.id, { projectId: project.id, status: "in_progress" });
  const again = await taskService.setTaskStatus(user.id, task.id, "in_progress");
  assert.equal(again.status, "in_progress");
  assert.equal(again.completedAt, null);
  assert.equal(await progressOf(project.id), 0);
});
