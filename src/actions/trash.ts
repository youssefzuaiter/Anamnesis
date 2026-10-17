"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as noteService from "@/services/note-service";
import * as taskService from "@/services/task-service";
import * as projectService from "@/services/project-service";
import * as goalService from "@/services/goal-service";
import { TRASH_KINDS, type TrashKind } from "@/lib/domain";

const targetSchema = z.object({
  kind: z.enum(TRASH_KINDS),
  id: z.uuid(),
});

const RESTORE: Record<TrashKind, (userId: string, id: string) => Promise<unknown>> = {
  note: noteService.restoreNote,
  task: taskService.restoreTask,
  project: projectService.restoreProject,
  goal: goalService.restoreGoal,
};

const PURGE: Record<TrashKind, (userId: string, id: string) => Promise<void>> = {
  note: noteService.purgeNote,
  task: taskService.purgeTask,
  project: projectService.purgeProject,
  goal: goalService.purgeGoal,
};

function revalidateAll(): void {
  revalidatePath("/trash");
  revalidatePath("/notes");
  revalidatePath("/tasks");
  revalidatePath("/projects");
  revalidatePath("/goals");
  revalidatePath("/");
}

export async function restoreAction(
  raw: { kind: string; id: string },
): Promise<ApiResponse<null>> {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Nothing to restore.");

  try {
    const userId = await requireUserId();
    await RESTORE[parsed.data.kind](userId, parsed.data.id);
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateAll();
  return ok(null);
}

export async function purgeAction(
  raw: { kind: string; id: string },
): Promise<ApiResponse<null>> {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Nothing to delete.");

  try {
    const userId = await requireUserId();
    await PURGE[parsed.data.kind](userId, parsed.data.id);
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateAll();
  return ok(null);
}
