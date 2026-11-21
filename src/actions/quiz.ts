"use server";

import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { revalidatePath } from "next/cache";
import { QUIZ_MAX_COUNT, checkAnswerInputSchema, keepQuestionInputSchema, quizScopeSchema, type CheckResult } from "@/lib/quiz";
import * as quizService from "@/services/quiz-service";

const startSchema = z.object({
  scope: quizScopeSchema,
  count: z.number().int().min(1).max(QUIZ_MAX_COUNT),
});

/**
 * Chooses the questions for a quiz over one note or course. Nothing is stored: there is no
 * revalidation because no page shows anything this changes.
 */
export async function startQuizAction(
  scope: unknown,
  count: number,
): Promise<ApiResponse<quizService.StartResult>> {
  try {
    const userId = await requireUserId();
    const parsed = startSchema.safeParse({ scope, count });
    if (!parsed.success) return fail("VALIDATION_ERROR", "That quiz is not valid.");
    return ok(await quizService.startQuiz(userId, parsed.data.scope, { count: parsed.data.count }));
  } catch (error) {
    return toApiResponse(error);
  }
}

/** Checks one typed answer. It suggests a verdict and never records a grade. */
export async function checkAnswerAction(input: unknown): Promise<ApiResponse<CheckResult>> {
  try {
    const userId = await requireUserId();
    const parsed = checkAnswerInputSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION_ERROR", "That answer is not valid. Check its length.");
    return ok(await quizService.checkAnswer(userId, parsed.data));
  } catch (error) {
    return toApiResponse(error);
  }
}

/**
 * Keeps a missed generated question as a card on the note it came from. The browser sends the note, the question and its answer (a generated
 * question is stored nowhere), so all three are client input: strict Zod here, the note checked as the caller's in the service.
 */
export async function keepQuestionAction(input: unknown): Promise<ApiResponse<{ created: number; existing: boolean }>> {
  try {
    const userId = await requireUserId();
    const parsed = keepQuestionInputSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION_ERROR", "That question cannot be kept. Check its length.");
    const result = await quizService.keepQuizQuestion(userId, parsed.data);
    if (result.created > 0) {
      revalidatePath("/cards");
      revalidatePath("/");
    }
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}
