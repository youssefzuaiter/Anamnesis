"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { requireUserId } from "@/lib/session";
import {
  beginSetup,
  confirmSetup,
  disableTwoFactor,
  regenerateRecoveryCodes,
} from "@/services/two-factor-service";

// Every action: the account is the session's (`requireUserId`), the input is validated, and nothing but the
// two fields below is read from the browser. The password and codes are bounded so a huge string is a refusal.
const confirmSchema = z.object({ code: z.string().max(32) });
const changeSchema = z.object({ password: z.string().min(1, "Enter your password.").max(200), code: z.string().max(100) });
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Please check the form and try again.";

export async function beginTwoFactorAction(): Promise<ApiResponse<{ secret: string; uri: string; qrSvg: string }>> {
  try {
    const userId = await requireUserId();
    const email = (await auth())?.user?.email ?? "account";
    return ok(await beginSetup(userId, email));
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function confirmTwoFactorAction(input: unknown): Promise<ApiResponse<{ recoveryCodes: string[] }>> {
  try {
    const userId = await requireUserId();
    const parsed = confirmSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));
    const result = await confirmSetup(userId, parsed.data.code, Date.now());
    revalidatePath("/settings");
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function disableTwoFactorAction(input: unknown): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    const parsed = changeSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));
    await disableTwoFactor(userId, parsed.data.password, parsed.data.code, Date.now());
    revalidatePath("/settings");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function regenerateRecoveryCodesAction(input: unknown): Promise<ApiResponse<{ recoveryCodes: string[] }>> {
  try {
    const userId = await requireUserId();
    const parsed = changeSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));
    const result = await regenerateRecoveryCodes(userId, parsed.data.password, parsed.data.code, Date.now());
    revalidatePath("/settings");
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}
