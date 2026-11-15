import "server-only";
import { AppError } from "@/lib/api-response";
import { todoTitles } from "@/lib/todo-lines";
import { titleKey } from "@/lib/assistant-edits";
import * as noteRepository from "@/repositories/note-repository";
import * as taskRepository from "@/repositories/task-repository";
import { createTask } from "@/services/task-service";

/**
 * Turns a note's TODO lines into tasks (ROADMAP item 33). Proposal and confirmation follow Plan my day: the note is
 * read again on the server when the person confirms, and the browser's list of titles only chooses among those the
 * server finds in the note. A line whose title matches any task the account has (open, done or trashed) is not
 * offered again.
 */

async function ownNote(userId: string, noteId: string) {
  const note = await noteRepository.getNote(userId, noteId);
  if (!note) throw new AppError("RESOURCE_NOT_FOUND", "That note does not exist.");
  return note;
}

async function existingKeys(userId: string): Promise<Set<string>> {
  return new Set((await taskRepository.listAllTaskTitles(userId)).map(titleKey));
}

export async function proposeTodoTasks(userId: string, noteId: string): Promise<string[]> {
  const note = await ownNote(userId, noteId);
  const existing = await existingKeys(userId);
  return todoTitles(note.content).filter((title) => !existing.has(titleKey(title)));
}

/** Creates the tasks the person chose from the note's current lines. Returns how many were made. */
export async function createTodoTasks(userId: string, noteId: string, chosen: readonly string[]): Promise<number> {
  const note = await ownNote(userId, noteId);
  const existing = await existingKeys(userId);
  const wanted = new Set(chosen.map(titleKey));
  const offered = todoTitles(note.content).filter((title) => wanted.has(titleKey(title)) && !existing.has(titleKey(title)));
  for (const title of offered) {
    await createTask(userId, {
      title,
      description: null,
      priority: "medium",
      tags: [],
      dueDate: null,
      estimatedMinutes: 60,
      projectId: null,
      courseId: note.courseId,
      goalId: null,
      scheduledStart: null,
      scheduledEnd: null,
    });
  }
  return offered.length;
}
