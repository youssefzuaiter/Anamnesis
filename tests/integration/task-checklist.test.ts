/**
 * Task checklists against a real Postgres, DB-only like the rest of this tier. Each test makes its own
 * accounts so one test's rows cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { MAX_CHECKLIST_ITEMS } from "@/lib/checklist";
import { getGoalTaskTotals } from "@/repositories/goal-repository";
import * as checklistRepository from "@/repositories/task-checklist-repository";
import * as service from "@/services/task-checklist-service";
import { buildFullExport } from "@/services/export-service";
import * as taskService from "@/services/task-service";

const users: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { email: `checklist-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const makeTask = (userId: string, extra: Record<string, unknown> = {}) => prisma.task.create({ data: { userId, title: "A task", ...extra } });
const titles = async (userId: string, taskId: string) => (await service.getChecklist(userId, taskId)).items.map((i) => i.title);
const same = (error: unknown) => error instanceof AppError && error.code === "RESOURCE_NOT_FOUND" && error.message === "That checklist item no longer exists.";

test("a checklist is in order, carries its progress, and its steps start undone", async () => {
  const user = await newUser();
  const task = await makeTask(user.id);
  assert.deepEqual(await service.getChecklist(user.id, task.id), { items: [], progress: { done: 0, total: 0, complete: false } });
  for (const title of ["First", "Second", "Third"]) await service.addItem(user.id, task.id, title);
  const { items, progress } = await service.getChecklist(user.id, task.id);
  assert.deepEqual(items.map((i) => [i.title, i.done]), [["First", false], ["Second", false], ["Third", false]]);
  assert.deepEqual(progress, { done: 0, total: 3, complete: false });
  await service.setItemDone(user.id, items[1].id, true);
  assert.deepEqual((await service.getChecklist(user.id, task.id)).progress, { done: 1, total: 3, complete: false });
});

test("a title is cleaned, an empty one and the 51st step are refused", async () => {
  const user = await newUser();
  const task = await makeTask(user.id);
  await service.addItem(user.id, task.id, "  Line\r\none \u0007 two  ");
  await service.addItem(user.id, task.id, "x".repeat(300));
  const items = (await service.getChecklist(user.id, task.id)).items;
  assert.equal(items[0].title, "Line one two");
  assert.equal(items[1].title.length, 200);
  for (const empty of ["", "   ", "\u0000\u0001", "\n\t"]) {
    await assert.rejects(() => service.addItem(user.id, task.id, empty), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_ERROR" && /what needs doing/i.test(e.message));
  }
  await prisma.taskChecklistItem.createMany({ data: Array.from({ length: MAX_CHECKLIST_ITEMS - 2 }, (_, i) => ({ userId: user.id, taskId: task.id, title: `bulk ${i}`, position: 10 + i })) });
  assert.equal((await service.getChecklist(user.id, task.id)).items.length, MAX_CHECKLIST_ITEMS);
  await assert.rejects(() => service.addItem(user.id, task.id, "one too many"), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_ERROR" && /at most 50/i.test(e.message));
  assert.equal(await prisma.taskChecklistItem.count({ where: { taskId: task.id } }), MAX_CHECKLIST_ITEMS);
});

test("ticking and renaming persist, and leave the task's own columns alone", async () => {
  const user = await newUser();
  const task = await makeTask(user.id, { description: "keep me", priority: "high" });
  await service.addItem(user.id, task.id, "Step");
  const [item] = (await service.getChecklist(user.id, task.id)).items;
  await service.setItemDone(user.id, item.id, true);
  await service.renameItem(user.id, item.id, "  Renamed  step ");
  const [after] = (await service.getChecklist(user.id, task.id)).items;
  assert.deepEqual([after.title, after.done], ["Renamed step", true]);
  await service.setItemDone(user.id, item.id, false);
  assert.equal((await service.getChecklist(user.id, task.id)).items[0].done, false);
  const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.deepEqual([row.title, row.description, row.priority, row.status, +row.updatedAt], [task.title, "keep me", "high", "todo", +task.updatedAt]);
  await assert.rejects(() => service.renameItem(user.id, item.id, "   "), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_ERROR");
});

test("a foreign, missing, trashed or deleted-task id gets the same refusal from every operation, and nothing of the other account changes", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const aliceTask = await makeTask(alice.id, { title: "Alice's" });
  await service.addItem(alice.id, aliceTask.id, "Alice step");
  const [aliceItem] = (await service.getChecklist(alice.id, aliceTask.id)).items;
  const trashedTask = await makeTask(alice.id, { title: "Trashed", deletedAt: new Date() });
  const trashedItem = await prisma.taskChecklistItem.create({ data: { userId: alice.id, taskId: trashedTask.id, title: "In the trash", position: 0 } });
  const before = await prisma.taskChecklistItem.findMany({ where: { userId: alice.id }, orderBy: { id: "asc" } });

  const itemAttacks: [string, (itemId: string) => Promise<unknown>][] = [
    ["tick", (id) => service.setItemDone(bob.id, id, true)],
    ["rename", (id) => service.renameItem(bob.id, id, "Hijacked")],
    ["remove", (id) => service.removeItem(bob.id, id)],
    ["up", (id) => service.moveItem(bob.id, id, "up")],
    ["down", (id) => service.moveItem(bob.id, id, "down")],
  ];
  for (const [name, attack] of itemAttacks) {
    for (const id of [aliceItem.id, randomUUID()]) await assert.rejects(() => attack(id), same, `${name} ${id === aliceItem.id ? "foreign" : "missing"}`);
  }
  // Alice herself cannot change a step of a task in her trash either.
  for (const [name, attack] of [
    ["tick", () => service.setItemDone(alice.id, trashedItem.id, true)],
    ["rename", () => service.renameItem(alice.id, trashedItem.id, "x")],
    ["remove", () => service.removeItem(alice.id, trashedItem.id)],
    ["move", () => service.moveItem(alice.id, trashedItem.id, "down")],
  ] as const) {
    await assert.rejects(attack, same, `${name} trashed`);
  }
  // Tasks: a foreign task, a missing one and a trashed one read and add alike.
  for (const taskId of [aliceTask.id, randomUUID(), trashedTask.id]) {
    for (const [name, op] of [
      ["get", () => service.getChecklist(bob.id, taskId)],
      ["add", () => service.addItem(bob.id, taskId, "Injected")],
    ] as const) {
      await assert.rejects(op, (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND", `${name} ${taskId}`);
    }
  }
  await assert.rejects(() => service.getChecklist(alice.id, trashedTask.id), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  const after = await prisma.taskChecklistItem.findMany({ where: { userId: alice.id }, orderBy: { id: "asc" } });
  assert.deepEqual(after, before, "every row of Alice's is byte for byte the same");
  assert.equal(await prisma.taskChecklistItem.count({ where: { userId: bob.id } }), 0);
});

test("steps move up and down, at the edges nothing moves, and gaps and duplicate positions are healed", async () => {
  const user = await newUser();
  const task = await makeTask(user.id);
  for (const t of ["a", "b", "c"]) await service.addItem(user.id, task.id, t);
  let items = (await service.getChecklist(user.id, task.id)).items;
  await service.moveItem(user.id, items[0].id, "down");
  assert.deepEqual(await titles(user.id, task.id), ["b", "a", "c"]);
  await service.moveItem(user.id, items[2].id, "up");
  assert.deepEqual(await titles(user.id, task.id), ["b", "c", "a"]);
  items = (await service.getChecklist(user.id, task.id)).items;
  await service.moveItem(user.id, items[0].id, "up"); // already first
  await service.moveItem(user.id, items[2].id, "down"); // already last
  assert.deepEqual(await titles(user.id, task.id), ["b", "c", "a"]);

  // Left by deletes and races: a gap, and two steps with one position.
  await prisma.taskChecklistItem.deleteMany({ where: { taskId: task.id } });
  const rows = await Promise.all(["x", "y", "z"].map((title, i) => prisma.taskChecklistItem.create({ data: { userId: user.id, taskId: task.id, title, position: [0, 7, 7][i] } })));
  const order = (await service.getChecklist(user.id, task.id)).items;
  await service.moveItem(user.id, order[0].id, "down");
  const healed = await prisma.taskChecklistItem.findMany({ where: { taskId: task.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  assert.deepEqual(healed.map((r) => r.position), [0, 1, 2], "positions are 0..n-1 after a move");
  assert.equal(rows.length, 3);
});

test("the repository writes positions only for the given user and task, whatever ids it is handed", async () => {
  // The service only passes the ids of the task's own steps; this holds the repository to its own scope.
  const alice = await newUser();
  const bob = await newUser();
  const task = await makeTask(alice.id);
  const other = await makeTask(alice.id);
  await service.addItem(alice.id, task.id, "Alice step");
  const [item] = (await service.getChecklist(alice.id, task.id)).items;
  const stored = async () => (await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).position;
  await checklistRepository.writePositions(bob.id, task.id, [{ id: item.id, position: 99 }]);
  assert.equal(await stored(), item.position, "another account cannot reposition it");
  await checklistRepository.writePositions(alice.id, other.id, [{ id: item.id, position: 99 }]);
  assert.equal(await stored(), item.position, "nor can the right account through another task");
  await checklistRepository.writePositions(alice.id, task.id, [{ id: item.id, position: 99 }]);
  assert.equal(await stored(), 99);
});

test("a move writes only the rows of its own task, and a removed step is gone", async () => {
  const user = await newUser();
  const one = await makeTask(user.id);
  const two = await makeTask(user.id);
  for (const t of ["a", "b"]) {
    await service.addItem(user.id, one.id, t);
    await service.addItem(user.id, two.id, t);
  }
  const twoBefore = await prisma.taskChecklistItem.findMany({ where: { taskId: two.id }, orderBy: { id: "asc" } });
  const [first] = (await service.getChecklist(user.id, one.id)).items;
  await service.moveItem(user.id, first.id, "down");
  assert.deepEqual(await prisma.taskChecklistItem.findMany({ where: { taskId: two.id }, orderBy: { id: "asc" } }), twoBefore);
  await service.removeItem(user.id, first.id);
  assert.deepEqual(await titles(user.id, one.id), ["b"]);
});

test("counts are the caller's, one grouped read, and nothing for a foreign or trashed task", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const mine = await makeTask(alice.id);
  const empty = await makeTask(alice.id);
  const trashed = await makeTask(alice.id, { deletedAt: new Date() });
  const theirs = await makeTask(bob.id);
  for (const t of ["a", "b", "c"]) await service.addItem(alice.id, mine.id, t);
  const [a] = (await service.getChecklist(alice.id, mine.id)).items;
  await service.setItemDone(alice.id, a.id, true);
  await service.addItem(bob.id, theirs.id, "Bob's");
  await prisma.taskChecklistItem.create({ data: { userId: alice.id, taskId: trashed.id, title: "hidden", position: 0 } });

  const counts = await service.checklistCounts(alice.id, [mine.id, empty.id, trashed.id, theirs.id]);
  assert.deepEqual([...counts.entries()], [[mine.id, { done: 1, total: 3 }]]);
  assert.equal((await service.checklistCounts(alice.id, [])).size, 0);
});

test("ticking and adding steps never move a project's or a goal's progress, and a task with steps counts once", async () => {
  const user = await newUser();
  const goal = await prisma.goal.create({ data: { userId: user.id, title: "Goal", category: "Personal" } });
  const project = await prisma.project.create({ data: { userId: user.id, goalId: goal.id, title: "Project", category: "Personal" } });
  const input = { description: null, priority: "medium" as const, tags: [], dueDate: null, estimatedMinutes: 60, courseId: null, scheduledStart: null, scheduledEnd: null };
  // Linked to the goal both directly and through its project: still one task in every count.
  const both = await taskService.createTask(user.id, { ...input, title: "Both paths", projectId: project.id, goalId: goal.id });
  const plain = await taskService.createTask(user.id, { ...input, title: "Plain", projectId: project.id, goalId: null });
  await taskService.setTaskStatus(user.id, plain.id, "done");

  const read = async () => ({
    project: (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).progress,
    goal: (await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })).progress,
    totals: await getGoalTaskTotals(user.id, goal.id),
  });
  const before = await read();
  assert.deepEqual(before.totals, { done: 1, total: 2 });
  assert.equal(before.project, 50);

  for (const t of ["a", "b", "c", "d"]) await service.addItem(user.id, both.id, t);
  for (const item of (await service.getChecklist(user.id, both.id)).items) await service.setItemDone(user.id, item.id, true);
  assert.deepEqual((await service.getChecklist(user.id, both.id)).progress, { done: 4, total: 4, complete: true });
  assert.deepEqual(await read(), before, "every step ticked, and no number moved");
  const status = (await prisma.task.findUniqueOrThrow({ where: { id: both.id } })).status;
  assert.equal(status, "todo", "ticking every step does not finish the task");
});

test("steps hide with a trashed task, return in order on restore, and go when the task is purged", async () => {
  const user = await newUser();
  const task = await taskService.createTask(user.id, { title: "Trashable", description: null, priority: "medium", tags: [], dueDate: null, estimatedMinutes: 60, projectId: null, courseId: null, goalId: null, scheduledStart: null, scheduledEnd: null });
  for (const t of ["a", "b", "c"]) await service.addItem(user.id, task.id, t);
  const [a, b] = (await service.getChecklist(user.id, task.id)).items;
  await service.setItemDone(user.id, b.id, true);
  await service.moveItem(user.id, a.id, "down");

  await taskService.deleteTask(user.id, task.id);
  await assert.rejects(() => service.getChecklist(user.id, task.id), (e: unknown) => e instanceof AppError && e.code === "RESOURCE_NOT_FOUND");
  assert.equal((await checklistRepository.countsForTasks(user.id, [task.id])).size, 0);
  assert.equal(await prisma.taskChecklistItem.count({ where: { taskId: task.id } }), 3, "kept while the task is in the trash");

  await taskService.restoreTask(user.id, task.id);
  const restored = (await service.getChecklist(user.id, task.id)).items;
  assert.deepEqual(restored.map((i) => [i.title, i.done]), [["b", true], ["a", false], ["c", false]]);

  await taskService.deleteTask(user.id, task.id);
  await taskService.purgeTask(user.id, task.id);
  assert.equal(await prisma.taskChecklistItem.count({ where: { taskId: task.id } }), 0, "gone with the task");
});

test("deleting the account removes its steps", async () => {
  const user = await newUser();
  const task = await makeTask(user.id);
  await service.addItem(user.id, task.id, "gone soon");
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.taskChecklistItem.count({ where: { taskId: task.id } }), 0);
});

test("the JSON export holds the steps of live tasks, and none of a trashed task's or another account's", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const live = await makeTask(alice.id, { title: "Live" });
  const trashed = await makeTask(alice.id, { title: "Trashed", deletedAt: new Date() });
  const theirs = await makeTask(bob.id);
  await service.addItem(alice.id, live.id, "Exported step");
  await prisma.taskChecklistItem.create({ data: { userId: alice.id, taskId: trashed.id, title: "Trashed step", position: 0 } });
  await service.addItem(bob.id, theirs.id, "Bob's step");
  const file = await buildFullExport(alice.id);
  const rows = (file as unknown as { checklistItems: { title: string; taskId: string; userId: string }[] }).checklistItems;
  assert.deepEqual(rows.map((r) => r.title), ["Exported step"]);
  assert.equal(rows[0].taskId, live.id);
  assert.equal(rows[0].userId, alice.id);
});

test("a title of markup is stored as text", async () => {
  const user = await newUser();
  const task = await makeTask(user.id);
  await service.addItem(user.id, task.id, "<img src=x onerror=alert(1)> & <b>");
  assert.equal((await service.getChecklist(user.id, task.id)).items[0].title, "<img src=x onerror=alert(1)> & <b>");
});

test("a missing or empty account id is refused before any query, by every function", async () => {
  for (const bad of [undefined, null, "", 42]) {
    for (const [name, fn] of [
      ["getChecklist", () => service.getChecklist(bad as never, randomUUID())],
      ["addItem", () => service.addItem(bad as never, randomUUID(), "x")],
      ["setItemDone", () => service.setItemDone(bad as never, randomUUID(), true)],
      ["renameItem", () => service.renameItem(bad as never, randomUUID(), "x")],
      ["removeItem", () => service.removeItem(bad as never, randomUUID())],
      ["moveItem", () => service.moveItem(bad as never, randomUUID(), "up")],
      ["checklistCounts", () => service.checklistCounts(bad as never, [randomUUID()])],
    ] as const) {
      await assert.rejects(fn, (e: unknown) => e instanceof AppError && e.code === "VALIDATION_ERROR", `${name} ${String(bad)}`);
    }
  }
});
