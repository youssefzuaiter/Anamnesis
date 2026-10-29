"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as linkSuggestionService from "@/services/link-suggestion-service";

const addLinkSchema = z.object({ fromId: z.uuid(), toId: z.uuid() });

/** Adds `[[To]]` under "See also" in the From note. Only ever called by a click. */
export async function addLinkAction(
  fromId: string,
  toId: string,
): Promise<ApiResponse<{ added: boolean }>> {
  try {
    const userId = await requireUserId();
    const parsed = addLinkSchema.safeParse({ fromId, toId });
    if (!parsed.success) return fail("VALIDATION_ERROR", "That note could not be linked.");

    const { added } = await linkSuggestionService.addLink(
      userId,
      parsed.data.fromId,
      parsed.data.toId,
    );
    revalidatePath("/notes");
    revalidatePath(`/notes/${parsed.data.fromId}`);
    revalidatePath(`/notes/${parsed.data.toId}`);
    return ok({ added });
  } catch (error) {
    return toApiResponse(error);
  }
}
