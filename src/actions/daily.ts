"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { carryDetail, dailyTitle, type CarryOverItem } from "@/lib/daily";
import { dateLabel } from "@/lib/note-templates";
import * as dailyService from "@/services/daily-service";

export type ShutdownTaskView = {
  id: string;
  title: string;
  priority: string;
  /** The small line under the title; empty when there is nothing to say. */
  detail: string;
};

export type ShutdownView = {
  /** The local day this was proposed for (`2026-10-28`); sent back with the confirmation. */
  day: string;
  tomorrowLabel: string;
  dueToday: ShutdownTaskView[];
  overdue: ShutdownTaskView[];
};

function view(item: CarryOverItem, group: "dueToday" | "overdue"): ShutdownTaskView {
  return {
    id: item.id,
    title: item.title,
    priority: item.priority,
    detail: carryDetail(item, group),
  };
}

export async function openTodayNoteAction(): Promise<ApiResponse<{ id: string }>> {
  try {
    const userId = await requireUserId();
    const { id } = await dailyService.openTodayNote(userId, new Date());
    revalidatePath("/");
    revalidatePath("/notes");
    return ok({ id });
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function proposeShutdownAction(): Promise<ApiResponse<ShutdownView>> {
  try {
    const userId = await requireUserId();
    const now = new Date();
    const plan = await dailyService.proposeShutdown(userId, now);
    return ok({
      day: dailyTitle(now),
      tomorrowLabel: dateLabel(plan.tomorrow),
      dueToday: plan.dueToday.map((item) => view(item, "dueToday")),
      overdue: plan.overdue.map((item) => view(item, "overdue")),
    });
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function applyShutdownAction(
  taskIds: string[],
  day: string,
): Promise<ApiResponse<{ moved: number; tomorrowLabel: string }>> {
  const parsed = z
    .object({
      taskIds: z.array(z.uuid()).min(1).max(100),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse({ taskIds, day });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Nothing to move.");

  try {
    const userId = await requireUserId();
    const now = new Date();
    const { moved, tomorrow } = await dailyService.applyShutdown(
      userId,
      now,
      parsed.data.taskIds,
      parsed.data.day,
    );

    revalidatePath("/");
    revalidatePath("/tasks");
    revalidatePath("/calendar");
    return ok({ moved, tomorrowLabel: dateLabel(tomorrow) });
  } catch (error) {
    return toApiResponse(error);
  }
}
