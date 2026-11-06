"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as service from "@/services/task-checklist-service";

/**
 * The checklist actions take ids, not forms: the component calls them from click handlers. Every id is a
 * uuid checked here and then ownership-checked in the query that uses it; a title is bounded before it is
 * cleaned (the service cleans it). The account is the session's, never an argument.
 */

const id = z.uuid();
const rawTitle = z.string().max(2000, "That is too long for a checklist item.");

function refresh(): void {
  revalidatePath("/tasks");
  revalidatePath("/tasks/[id]", "page");
}

/** Runs one change: the session, the validated input, the service, a refresh; a failure is a plain message. */
async function change<T>(parse: () => z.ZodSafeParseResult<T>, run: (userId: string, input: T) => Promise<void>): Promise<ApiResponse<null>> {
  const parsed = parse();
  if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "That is not a valid request.");
  try {
    const userId = await requireUserId();
    await run(userId, parsed.data);
  } catch (error) {
    return toApiResponse(error);
  }
  refresh();
  return ok(null);
}

export async function addChecklistItemAction(taskId: string, title: string): Promise<ApiResponse<null>> {
  return change(
    () => z.object({ taskId: id, title: rawTitle }).safeParse({ taskId, title }),
    async (userId, input) => void (await service.addItem(userId, input.taskId, input.title)),
  );
}

export async function toggleChecklistItemAction(itemId: string, done: boolean): Promise<ApiResponse<null>> {
  return change(
    () => z.object({ itemId: id, done: z.boolean() }).safeParse({ itemId, done }),
    (userId, input) => service.setItemDone(userId, input.itemId, input.done),
  );
}

export async function renameChecklistItemAction(itemId: string, title: string): Promise<ApiResponse<null>> {
  return change(
    () => z.object({ itemId: id, title: rawTitle }).safeParse({ itemId, title }),
    (userId, input) => service.renameItem(userId, input.itemId, input.title),
  );
}

export async function removeChecklistItemAction(itemId: string): Promise<ApiResponse<null>> {
  return change(
    () => z.object({ itemId: id }).safeParse({ itemId }),
    (userId, input) => service.removeItem(userId, input.itemId),
  );
}

export async function moveChecklistItemAction(itemId: string, direction: "up" | "down"): Promise<ApiResponse<null>> {
  return change(
    () => z.object({ itemId: id, direction: z.enum(["up", "down"]) }).safeParse({ itemId, direction }),
    (userId, input) => service.moveItem(userId, input.itemId, input.direction),
  );
}
