"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, toApiResponse } from "@/lib/api-response";
import { createGoal, removeGoal, setGoalTarget } from "@/services/weekly-goal-service";

/** The account always comes from the session; the browser sends a measure and a target, or a goal's id. Everything is checked again in the service. */
function refresh() {
  revalidatePath("/stats");
  revalidatePath("/");
}

export async function addWeeklyGoalAction(raw: unknown): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    await createGoal(userId, raw);
    refresh();
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function setWeeklyGoalTargetAction(id: unknown, target: unknown): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    await setGoalTarget(userId, typeof id === "string" ? id : "", target);
    refresh();
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function removeWeeklyGoalAction(id: unknown): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    await removeGoal(userId, typeof id === "string" ? id : "");
    refresh();
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}
