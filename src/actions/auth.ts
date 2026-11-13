"use server";

import { z } from "zod";
import { auth, signIn, signOut } from "@/auth";
import { endSession } from "@/services/session-service";
import { registerAccount } from "@/services/registration-service";
import { config } from "@/lib/config";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import {
  isRateLimited,
  registerFailedAttempt,
  clearAttempts,
  minutesUntilReset,
} from "@/lib/rate-limit";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(200),
});

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  // Left blank by everyone who has not turned two-factor on; see `authorize` in src/auth.ts.
  code: z.string().max(100).default(""),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

export async function registerAction(
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", firstIssue(parsed.error));
  }

  const { name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  try {
    // The invite code goes to the service as given; it decides whether one is needed at all.
    await registerAccount({ name, email, password, inviteCode: formData.get("inviteCode") }, config.REGISTRATION_CODE);
    await signIn("credentials", { email, password, redirect: false });
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function loginAction(
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    code: formData.get("code") ?? undefined,
  });

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", firstIssue(parsed.error));
  }

  const { password, code } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  // Keyed by email, not IP: the thing worth throttling is guessing one
  // account's password, and this app has no reason to trust a client IP.
  if (isRateLimited(email)) {
    const minutes = minutesUntilReset(email);
    return fail(
      "RATE_LIMITED",
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  try {
    await signIn("credentials", { email, password, code, redirect: false });
    clearAttempts(email);
    return ok(null);
  } catch {
    registerFailedAttempt(email);
    // Never distinguish "no such account" from "wrong password" here.
    return fail("AUTH_REQUIRED", "Incorrect email, password or code.");
  }
}

export async function signOutAction(): Promise<void> {
  // End this device's own session row first: a copy of the cookie must stop working too, which
  // clearing the cookie alone would not do.
  const session = await auth();
  if (session?.user?.id && session.sessionId) await endSession(session.user.id, session.sessionId);
  await signOut({ redirectTo: "/login" });
}
