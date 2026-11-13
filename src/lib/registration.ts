import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Who may create an account (ROADMAP item 25). Pure: no Prisma, no env, so the rules are
 * unit-tested and the service only supplies the account count and the configured code.
 *
 * - `open`: no account exists yet, so the owner can make the first one with no setup.
 * - `code`: accounts exist and an invite code is configured; `/register` asks for it.
 * - `closed`: accounts exist and no code is configured; `/register` makes nothing.
 */
export type RegistrationMode = "open" | "code" | "closed";

/** Long enough that guessing it over the network is hopeless, so no rate limit is needed. */
export const MIN_CODE_LENGTH = 16;

export function registrationMode(userCount: number, code: string | undefined): RegistrationMode {
  if (userCount === 0) return "open";
  return code ? "code" : "closed";
}

/** `REGISTRATION_CODE`: unset or blank is no code; anything shorter than the minimum stops start-up. */
export const registrationCode = z.preprocess(
  (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : typeof raw === "string" ? raw.trim() : raw),
  z.string().min(MIN_CODE_LENGTH, `REGISTRATION_CODE must be at least ${MIN_CODE_LENGTH} characters.`).optional(),
);

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest();

/** Compares fixed-length digests in constant time, so the response time says nothing about the code. */
export function codeMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  return timingSafeEqual(digest(given.trim()), digest(expected));
}
