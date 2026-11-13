"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { requireUserId } from "@/lib/session";
import { revokeAllSessions, revokeOtherSessions, revokeSession } from "@/services/session-service";

// The account is the session's (`requireUserId`); the only thing read from the browser is the id of
// the session to end, which the service scopes to that account (another account's id is "does not exist").
const revokeSchema = z.object({ sessionId: z.string().min(1).max(100) });

async function currentSessionId(): Promise<string | null> {
  return (await auth())?.sessionId ?? null;
}

export async function revokeSessionAction(input: unknown): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Choose a session to sign out.");
    await revokeSession(userId, parsed.data.sessionId, await currentSessionId());
    revalidatePath("/settings");
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

/** Ends every session but this one; returns how many were ended. */
export async function revokeOtherSessionsAction(): Promise<ApiResponse<{ ended: number }>> {
  try {
    const userId = await requireUserId();
    const current = await currentSessionId();
    if (!current) return fail("AUTH_REQUIRED", "Sign in again to do that.");
    const ended = await revokeOtherSessions(userId, current);
    revalidatePath("/settings");
    return ok({ ended });
  } catch (error) {
    return toApiResponse(error);
  }
}

/** Ends every session including this one, then goes to the sign-in page. */
export async function signOutEverywhereAction(): Promise<void> {
  const userId = await requireUserId();
  await revokeAllSessions(userId);
  await signOut({ redirectTo: "/login" });
}
