"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, AppError, fail, ok, toApiResponse } from "@/lib/api-response";
import { ntfyPublisher } from "@/lib/ntfy";
import * as reminderPush from "@/services/reminder-push-service";
import type { PushSettings } from "@/services/reminder-push-service";

const settingsSchema = z.object({
  enabled: z.boolean(),
  leadMinutes: z.number().int(),
  digestHour: z.number().int(),
  showTitles: z.boolean(),
});

export async function setPushSettingsAction(raw: unknown): Promise<ApiResponse<PushSettings>> {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Invalid settings.");

  try {
    const userId = await requireUserId();
    const settings = await reminderPush.setPushSettings(userId, parsed.data);
    revalidatePath("/settings");
    return ok(settings);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function sendTestNotificationAction(): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    const url = process.env.NTFY_URL?.trim();
    const token = process.env.NTFY_TOKEN?.trim();
    if (!url || !token) return fail("INTEGRATION_ERROR", "Phone reminders are not set up on this server.");

    try {
      await reminderPush.sendTestNotification(userId, ntfyPublisher(url, token));
    } catch (error) {
      if (error instanceof AppError) throw error;
      // The publisher's messages carry a status or "did not answer", never the token.
      const reason = error instanceof Error ? error.message : "it could not be sent";
      return fail("INTEGRATION_ERROR", `The test did not go through: ${reason}.`);
    }
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}
