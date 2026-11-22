"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { AREA_SETTINGS } from "@/lib/areas";
import { setAreasSetting } from "@/repositories/profile-repository";

/** Chooses which areas of life the signed-in account keeps. Only the three exact values are accepted; the account is the session's. */
export async function setAreasAction(areas: unknown): Promise<ApiResponse<{ areas: (typeof AREA_SETTINGS)[number] }>> {
  const parsed = z.enum(AREA_SETTINGS).safeParse(areas);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Choose School, Work or Both.");
  try {
    const userId = await requireUserId();
    await setAreasSetting(userId, parsed.data);
    // The menu is in the shared layout, so every page catches up.
    revalidatePath("/", "layout");
    return ok({ areas: parsed.data });
  } catch (error) {
    return toApiResponse(error);
  }
}
