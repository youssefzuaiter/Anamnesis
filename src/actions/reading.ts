"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { readingSchema } from "@/lib/reading";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { setReading } from "@/services/reference-service";

const idSchema = z.uuid();

/** Sets a reference's reading status and one-line takeaway (ROADMAP item 43). The account comes from the session; nothing else is taken from the browser. */
export async function setReadingAction(id: unknown, raw: unknown): Promise<ApiResponse<{ status: string; takeaway: string | null }>> {
  try {
    const userId = await requireUserId();
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) return fail("RESOURCE_NOT_FOUND", "That reference does not exist.");
    const parsed = readingSchema.safeParse(raw);
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Choose a status and try again.");
    const saved = await setReading(userId, parsedId.data, parsed.data);
    revalidatePath("/references");
    revalidatePath(`/references/${saved.id}`);
    return ok({ status: saved.readStatus, takeaway: saved.takeaway });
  } catch (error) {
    return toApiResponse(error);
  }
}
