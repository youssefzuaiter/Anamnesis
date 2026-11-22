"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { confirmRowsSchema } from "@/lib/post-intake";
import * as postService from "@/services/post-intake-service";

/** Reads a pasted post for the work it sets. Nothing is written: it returns a proposal to edit. */
export async function readPostAction(text: string, courseId: string | null): Promise<ApiResponse<postService.PostProposal>> {
  const parsed = postService.proposeInput.safeParse({ text, courseId });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Paste the teacher's post first (at most 20,000 characters).");
  try {
    const userId = await requireUserId();
    return ok(await postService.proposeFromPost(userId, parsed.data.text, parsed.data.courseId));
  } catch (error) {
    return toApiResponse(error);
  }
}

/** Adds the tasks the person confirmed. The rows come back from the browser: a strict list, each checked again, every course checked as the caller's. */
export async function addPostTasksAction(rows: unknown): Promise<ApiResponse<{ created: number }>> {
  const parsed = confirmRowsSchema.safeParse(rows);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Check the names and dates: at most 20 rows.");
  try {
    const userId = await requireUserId();
    const result = await postService.addTasksFromPost(userId, parsed.data);
    revalidatePath("/tasks");
    revalidatePath("/");
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}
