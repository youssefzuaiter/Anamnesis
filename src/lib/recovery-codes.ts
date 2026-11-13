import { createHash, randomBytes } from "node:crypto";
import { base32Encode } from "@/lib/totp";

/**
 * One-time codes for a lost authenticator: 80 random bits each, so a stored SHA-256 hash cannot be
 * guessed offline (a slow hash is for passwords people choose). Shown once, used once.
 */
export const RECOVERY_CODE_COUNT = 10;

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const text = base32Encode(randomBytes(10)).toLowerCase();
    return text.match(/.{4}/g)!.join("-");
  });
}

export function normaliseRecoveryCode(typed: string): string {
  return typed.toLowerCase().replace(/[\s-]/g, "");
}

export function hashRecoveryCode(typed: string): string {
  return createHash("sha256").update(normaliseRecoveryCode(typed), "utf8").digest("hex");
}

/** Cheap test before a database lookup: sixteen base32 characters once spaces and hyphens are gone. */
export function looksLikeRecoveryCode(typed: unknown): typed is string {
  return typeof typed === "string" && typed.length <= 100 && /^[a-z2-7]{16}$/.test(normaliseRecoveryCode(typed));
}
