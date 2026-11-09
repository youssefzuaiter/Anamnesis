"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { switchSchema, timerSessionSchema, writingSessionSchema } from "@/lib/focus-input";
import * as focusService from "@/services/focus-service";
import type { FocusSwitches } from "@/services/focus-service";

export async function recordFocusSessionAction(
  raw: unknown,
): Promise<ApiResponse<null>> {
  const parsed = writingSessionSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Invalid session.");

  try {
    const userId = await requireUserId();
    await focusService.recordWritingSession(userId, parsed.data);
    revalidatePath("/focus");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function recordTimerSessionAction(
  raw: unknown,
): Promise<ApiResponse<{ saved: boolean; seconds: number; courseCode: string | null }>> {
  const parsed = timerSessionSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Invalid session.");

  try {
    const userId = await requireUserId();
    const result = await focusService.recordTimerSession(userId, parsed.data);
    if (result.saved) revalidatePath("/focus");
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}

async function changeSwitch(
  enabled: unknown,
  change: (userId: string, enabled: boolean) => Promise<FocusSwitches>,
): Promise<ApiResponse<FocusSwitches>> {
  const parsed = switchSchema.safeParse(enabled);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Invalid setting.");

  try {
    const userId = await requireUserId();
    const switches = await change(userId, parsed.data);
    revalidatePath("/focus");
    return ok(switches);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function setFocusTrackingAction(enabled: boolean) {
  return changeSwitch(enabled, focusService.setTracking);
}

export async function setFocusCourseAction(enabled: boolean) {
  return changeSwitch(enabled, focusService.setIncludeCourse);
}

export async function setTimerSessionsAction(enabled: boolean) {
  return changeSwitch(enabled, focusService.setTimerSessions);
}

export async function clearFocusHistoryAction(): Promise<ApiResponse<{ deleted: number }>> {
  try {
    const userId = await requireUserId();
    const deleted = await focusService.clearHistory(userId);
    revalidatePath("/focus");
    return ok({ deleted });
  } catch (error) {
    return toApiResponse(error);
  }
}
