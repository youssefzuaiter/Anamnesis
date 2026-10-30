"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { MAX_POINTS, MAX_SCALE_ENTRIES, type GradeScale } from "@/lib/gpa-scale";
import * as gpaService from "@/services/gpa-service";

const courseGradeSchema = z.object({
  courseId: z.uuid(),
  credits: z.number().min(0).max(gpaService.MAX_CREDITS).nullable(),
  finalGrade: z.string().trim().max(4).nullable(),
});

const targetSchema = z.number().positive().max(MAX_POINTS).nullable();

const scaleSchema = z
  .array(z.object({ letter: z.string().max(10), points: z.number() }))
  .max(MAX_SCALE_ENTRIES)
  .nullable();

/**
 * Called from the course page's controls with the latest absolute values, never a
 * delta: Next dispatches a client's actions one at a time, in order.
 */
export async function setCourseGradeAction(
  courseId: string,
  credits: number | null,
  finalGrade: string | null,
): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    const parsed = courseGradeSchema.safeParse({ courseId, credits, finalGrade });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Check the credits and the letter.");

    await gpaService.setCourseGrade(userId, parsed.data.courseId, {
      credits: parsed.data.credits,
      finalGrade: parsed.data.finalGrade,
    });
    revalidatePath("/courses");
    revalidatePath(`/courses/${parsed.data.courseId}`);
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function setTargetGpaAction(target: number | null): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    const parsed = targetSchema.safeParse(target);
    if (!parsed.success) return fail("VALIDATION_ERROR", "That target is outside your scale.");

    await gpaService.setTargetGpa(userId, parsed.data);
    revalidatePath("/courses");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

/** A null scale resets to the preset. */
export async function saveGradeScaleAction(scale: GradeScale | null): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    const parsed = scaleSchema.safeParse(scale);
    if (!parsed.success) return fail("VALIDATION_ERROR", "That scale cannot be saved.");

    await gpaService.saveGradeScale(userId, parsed.data);
    revalidatePath("/courses");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}
