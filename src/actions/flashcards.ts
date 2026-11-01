"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { MAX_CLOZE_TEXT } from "@/lib/cloze";
import { MAX_CARD_ANSWER, MAX_CARD_QUESTION } from "@/lib/domain";
import { REVIEW_GRADES } from "@/lib/spaced-repetition";
import * as flashcardService from "@/services/flashcard-service";

// The service holds the rules and their messages; these bounds only keep an oversized
// string from reaching the parser at all.
const createCardSchema = z.object({
  noteId: z.uuid(),
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("basic"),
      question: z.string().trim().max(MAX_CARD_QUESTION),
      answer: z.string().trim().max(MAX_CARD_ANSWER),
    }),
    z.object({ kind: z.literal("cloze"), text: z.string().trim().max(MAX_CLOZE_TEXT) }),
  ]),
});

export async function createCardAction(
  noteId: string,
  input: unknown,
): Promise<ApiResponse<{ created: number }>> {
  try {
    const userId = await requireUserId();
    const parsed = createCardSchema.safeParse({ noteId, input });
    if (!parsed.success) return fail("VALIDATION_ERROR", "That card is not valid. Check its lengths.");

    const result = await flashcardService.createCardsForNote(
      userId,
      parsed.data.noteId,
      parsed.data.input,
    );
    revalidatePath("/cards");
    revalidatePath(`/notes/${parsed.data.noteId}`);
    revalidatePath("/");
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function generateCardsAction(
  noteId: string,
  count: number,
): Promise<ApiResponse<{ created: number }>> {
  const parsed = z
    .object({ noteId: z.uuid(), count: z.coerce.number().int().min(1).max(10) })
    .safeParse({ noteId, count });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown note.");

  try {
    const userId = await requireUserId();
    const result = await flashcardService.generateCardsForNote(
      userId,
      parsed.data.noteId,
      parsed.data.count,
    );
    revalidatePath("/cards");
    revalidatePath(`/notes/${parsed.data.noteId}`);
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function reviewCardAction(
  cardId: string,
  grade: string,
): Promise<ApiResponse<null>> {
  const parsed = z
    .object({ cardId: z.uuid(), grade: z.enum(REVIEW_GRADES) })
    .safeParse({ cardId, grade });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown card.");

  try {
    const userId = await requireUserId();
    await flashcardService.reviewCard(userId, parsed.data.cardId, parsed.data.grade);
    revalidatePath("/cards");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function deleteCardAction(
  cardId: string,
): Promise<ApiResponse<null>> {
  const parsed = z.uuid().safeParse(cardId);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown card.");

  try {
    const userId = await requireUserId();
    await flashcardService.deleteCard(userId, parsed.data);
    revalidatePath("/cards");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}
