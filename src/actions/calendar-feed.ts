"use server";

import { revalidatePath } from "next/cache";
import { type ApiResponse, ok, toApiResponse } from "@/lib/api-response";
import { requireUserId } from "@/lib/session";
import { createFeedLink, revokeFeedLink } from "@/services/calendar-feed-service";

/**
 * Makes the account's calendar feed link, or replaces it (the old address stops working at once). The
 * token comes back once: only its hash is stored, so it cannot be shown again. No input: the account is
 * the session's.
 */
export async function createFeedLinkAction(): Promise<ApiResponse<{ token: string; createdAt: string }>> {
  try {
    const userId = await requireUserId();
    const { token, createdAt } = await createFeedLink(userId);
    revalidatePath("/settings");
    return ok({ token, createdAt: createdAt.toISOString() });
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function revokeFeedLinkAction(): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    await revokeFeedLink(userId);
    revalidatePath("/settings");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}
