"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { MAX_SESSION_SECONDS } from "@/lib/focus";
import * as focusService from "@/services/focus-service";
import type { FocusSwitches } from "@/services/focus-service";

const sessionSchema = z.object({
  // Clamped rather than unbounded: these numbers come from a browser timer and
  // a keystroke counter, both of which a client could report as anything.
  activeSeconds: z.coerce.number().int().min(0).max(MAX_SESSION_SECONDS),
  charactersTyped: z.coerce.number().int().min(0).max(1_000_000),
  typingSpeedWpm: z.coerce.number().int().min(0).max(400),
  // The note's course, as the browser saw it. The server keeps it only if the person switched the
  // course on and the course is theirs.
  courseId: z.uuid().nullish(),
});

export async function recordFocusSessionAction(
  raw: unknown,
): Promise<ApiResponse<null>> {
  const parsed = sessionSchema.safeParse(raw);
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

const timerSchema = z.object({
  taskId: z.uuid(),
  seconds: z.coerce.number().int().min(0).max(MAX_SESSION_SECONDS),
});

export async function recordTimerSessionAction(
  raw: unknown,
): Promise<ApiResponse<{ saved: boolean; seconds: number; courseCode: string | null }>> {
  const parsed = timerSchema.safeParse(raw);
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
  const parsed = z.boolean().safeParse(enabled);
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
