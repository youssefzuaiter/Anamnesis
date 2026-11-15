"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, toApiResponse } from "@/lib/api-response";
import { keepBoth, mergeNotes, type MergeResult } from "@/services/duplicate-service";

// Both actions take ids (and, for a merge, the edit times shown) and nothing else: the service reads both notes as the
// session's user and works out the text itself, so a browser cannot choose what is written.

function refresh() {
  revalidatePath("/notes");
  revalidatePath("/notes/duplicates");
  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath("/cards");
  revalidatePath("/trash");
}

export async function keepBothAction(input: unknown): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    await keepBoth(userId, input);
    revalidatePath("/notes/duplicates");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function mergeNotesAction(input: unknown): Promise<ApiResponse<MergeResult>> {
  try {
    const userId = await requireUserId();
    const result = await mergeNotes(userId, input);
    refresh();
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}
