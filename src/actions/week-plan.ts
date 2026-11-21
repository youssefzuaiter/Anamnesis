"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { MAX_WEEK_BLOCKS } from "@/lib/week-planner";
import * as weekPlanService from "@/services/week-plan-service";

const weekSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What a week's plan would look like. Writes nothing. */
export async function proposeWeekAction(weekStart: string): Promise<ApiResponse<weekPlanService.WeekProposal>> {
  const parsed = weekSchema.safeParse(weekStart);
  if (!parsed.success) return fail("VALIDATION_ERROR", "That is not a week.");
  try {
    const userId = await requireUserId();
    return ok(await weekPlanService.proposeWeek(userId, parsed.data));
  } catch (error) {
    return toApiResponse(error);
  }
}

const picksSchema = z
  .array(z.object({ taskId: z.uuid(), start: z.iso.datetime() }).strict())
  .min(1)
  .max(MAX_WEEK_BLOCKS);

/**
 * Schedules the ticked blocks. Task ids and start times come back from the browser, so they are client input: they are only compared with the plan the
 * server works out again, and a block that no longer matches is left out and counted.
 */
export async function applyWeekAction(weekStart: string, picks: unknown): Promise<ApiResponse<{ scheduled: number; requested: number }>> {
  const week = weekSchema.safeParse(weekStart);
  const parsed = picksSchema.safeParse(picks);
  if (!week.success || !parsed.success) return fail("VALIDATION_ERROR", "Nothing to schedule.");
  try {
    const userId = await requireUserId();
    const result = await weekPlanService.applyWeek(userId, week.data, parsed.data);
    revalidatePath("/plan");
    revalidatePath("/");
    revalidatePath("/tasks");
    revalidatePath("/calendar");
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}
