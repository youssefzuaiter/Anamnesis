"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { timerStartSchema } from "@/lib/focus-input";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as timer from "@/services/focus-timer-service";
import type { TimerSnapshot } from "@/services/focus-timer-service";

type Result = ApiResponse<TimerSnapshot | null>;

async function run(work: (userId: string) => Promise<TimerSnapshot | null>, saves: boolean): Promise<Result> {
  try {
    const userId = await requireUserId();
    const snapshot = await work(userId);
    // Study time shows on the Focus page, so a command that may have saved some refreshes it.
    if (saves) revalidatePath("/focus");
    return ok(snapshot);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function startTimerAction(raw: unknown): Promise<Result> {
  const parsed = timerStartSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Choose how long to focus.");
  return run((userId) => timer.startTimer(userId, parsed.data), true);
}

export const pauseTimerAction = async (): Promise<Result> => run((userId) => timer.pauseTimer(userId), false);
export const resumeTimerAction = async (): Promise<Result> => run((userId) => timer.resumeTimer(userId), false);
export const resetTimerAction = async (): Promise<Result> => run((userId) => timer.resetTimer(userId), true);
export const skipToBreakAction = async (): Promise<Result> => run((userId) => timer.skipToBreakTimer(userId), true);
export const startBreakAction = async (): Promise<Result> => run((userId) => timer.startBreakTimer(userId), false);
export const skipBreakAction = async (): Promise<Result> => run((userId) => timer.skipBreakTimer(userId), false);
export const startNextFocusAction = async (): Promise<Result> => run((userId) => timer.startNextFocusTimer(userId), false);
export const stopTimerAction = async (): Promise<Result> =>
  run(async (userId) => {
    await timer.stopTimer(userId);
    return null;
  }, true);
