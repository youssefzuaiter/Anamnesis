"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { confirmRowsSchema } from "@/lib/syllabus";
import * as syllabusService from "@/services/syllabus-service";

/** Reads one note of the caller's for the assessments in it. Nothing is written: it returns a proposal to edit. */
export async function findAssessmentsAction(courseId: string, noteId: string): Promise<ApiResponse<syllabusService.AssessmentProposal>> {
  const parsed = z.object({ courseId: z.uuid(), noteId: z.uuid() }).strict().safeParse({ courseId, noteId });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Choose a note to read.");
  try {
    const userId = await requireUserId();
    return ok(await syllabusService.proposeAssessments(userId, parsed.data.courseId, parsed.data.noteId));
  } catch (error) {
    return toApiResponse(error);
  }
}

/**
 * Adds the assessments the person confirmed. The rows come back from the browser, so they are client input: a strict list of name, weight and
 * date, each checked again; the course is checked as the caller's in the service.
 */
export async function addAssessmentsAction(courseId: string, rows: unknown): Promise<ApiResponse<{ created: number }>> {
  const id = z.uuid().safeParse(courseId);
  if (!id.success) return fail("VALIDATION_ERROR", "Unknown course.");
  const parsed = confirmRowsSchema.safeParse(rows);
  if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.path.includes("weight") ? "Every assessment needs a weight from 0 to 100." : "Check the names, weights and dates: at most 30 rows.");
  try {
    const userId = await requireUserId();
    const result = await syllabusService.addAssessments(userId, id.data, parsed.data);
    revalidatePath(`/courses/${id.data}`);
    revalidatePath("/courses");
    revalidatePath("/");
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}
