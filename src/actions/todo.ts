"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { MAX_TODO_TITLE } from "@/lib/todo-lines";
import { createTodoTasks } from "@/services/todo-service";

// The browser sends the note and the titles the person ticked. Both are client input: the service reads the
// note again and only makes tasks from lines it finds there.
const schema = z.object({
  noteId: z.uuid(),
  titles: z.array(z.string().trim().min(1).max(MAX_TODO_TITLE)).max(100),
});

export async function createTodoTasksAction(input: unknown): Promise<ApiResponse<{ created: number }>> {
  try {
    const userId = await requireUserId();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Choose the lines to make into tasks.");
    const created = await createTodoTasks(userId, parsed.data.noteId, parsed.data.titles);
    revalidatePath(`/notes/${parsed.data.noteId}`);
    revalidatePath("/tasks");
    revalidatePath("/");
    return ok({ created });
  } catch (error) {
    return toApiResponse(error);
  }
}
