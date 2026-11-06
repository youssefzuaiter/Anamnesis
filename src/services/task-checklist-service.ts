import "server-only";
import { AppError } from "@/lib/api-response";
import { MAX_CHECKLIST_ITEMS, checklistProgress, cleanItemTitle, moveItem as planMove, type ChecklistProgress } from "@/lib/checklist";
import * as checklistRepository from "@/repositories/task-checklist-repository";
import * as taskRepository from "@/repositories/task-repository";

/**
 * A task's checklist. A step is not a task: nothing here touches a task's status or a project's or a goal's
 * progress, and a step is never indexed, scheduled or counted anywhere else. Every id from the browser is
 * checked in the query that uses it; a foreign step, a missing one and one of a trashed task are the same
 * refusal.
 */

export type ChecklistItem = { id: string; title: string; done: boolean; position: number };

const NOT_FOUND_ITEM = "That checklist item no longer exists.";

/** A session always gives a string; a missing id must never reach a query (in Prisma `undefined` means no filter). */
function assertAccount(userId: unknown): asserts userId is string {
  if (typeof userId !== "string" || userId === "") throw new AppError("VALIDATION_ERROR", "A checklist needs an account.");
}

async function assertTaskOwned(userId: string, taskId: string): Promise<void> {
  if (!(await taskRepository.getTask(userId, taskId))) throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
}

const asItem = (row: { id: string; title: string; done: boolean; position: number }): ChecklistItem => ({
  id: row.id,
  title: row.title,
  done: row.done,
  position: row.position,
});

function titleOrRefuse(raw: string): string {
  const title = cleanItemTitle(raw);
  if (title === "") throw new AppError("VALIDATION_ERROR", "Write what needs doing.");
  return title;
}

export async function getChecklist(userId: string, taskId: string): Promise<{ items: ChecklistItem[]; progress: ChecklistProgress }> {
  assertAccount(userId);
  await assertTaskOwned(userId, taskId);
  const items = (await checklistRepository.listForTask(userId, taskId)).map(asItem);
  return { items, progress: checklistProgress(items) };
}

/** Adds a step at the end, unless the task already holds 50: the repository counts and writes under a lock on the task. */
export async function addItem(userId: string, taskId: string, rawTitle: string): Promise<ChecklistItem> {
  assertAccount(userId);
  await assertTaskOwned(userId, taskId);
  const title = titleOrRefuse(rawTitle);
  const added = await checklistRepository.createIfRoom(userId, taskId, title, MAX_CHECKLIST_ITEMS);
  if (added.kind === "missing") throw new AppError("RESOURCE_NOT_FOUND", "That task no longer exists.");
  if (added.kind === "full") throw new AppError("VALIDATION_ERROR", `A checklist holds at most ${MAX_CHECKLIST_ITEMS} items.`);
  return asItem(added.item);
}

export async function setItemDone(userId: string, itemId: string, done: boolean): Promise<void> {
  assertAccount(userId);
  if (!(await checklistRepository.update(userId, itemId, { done }))) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND_ITEM);
}

export async function renameItem(userId: string, itemId: string, rawTitle: string): Promise<void> {
  assertAccount(userId);
  const title = titleOrRefuse(rawTitle);
  if (!(await checklistRepository.update(userId, itemId, { title }))) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND_ITEM);
}

export async function removeItem(userId: string, itemId: string): Promise<void> {
  assertAccount(userId);
  if (!(await checklistRepository.remove(userId, itemId))) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND_ITEM);
}

/** Moves a step one place. At an edge nothing changes and nothing is said: the buttons are disabled there. */
export async function moveItem(userId: string, itemId: string, direction: "up" | "down"): Promise<void> {
  assertAccount(userId);
  const item = await checklistRepository.getItem(userId, itemId);
  if (!item) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND_ITEM);
  const siblings = await checklistRepository.listForTask(userId, item.taskId);
  const changes = planMove(siblings, itemId, direction);
  if (changes) await checklistRepository.writePositions(userId, item.taskId, changes);
}

/** Done and total for each of these tasks that has steps; the task list shows them as a badge. */
export async function checklistCounts(userId: string, taskIds: string[]): Promise<Map<string, { done: number; total: number }>> {
  assertAccount(userId);
  return checklistRepository.countsForTasks(userId, taskIds);
}
