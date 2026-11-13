import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords, RFC 6238 over RFC 4226, with the parameters every authenticator app
 * implements: HMAC-SHA1, 6 digits, 30-second steps. Pure (no Prisma, no env), so it is tested against
 * the RFC's own vectors.
 */
export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** A code from one step before or after the current one is accepted, for a clock a few seconds off. */
const WINDOW = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Case, spaces and hyphens are ignored (keys are shown in groups); anything else is not base32. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]*$/.test(clean) || clean.length % 8 === 1 || clean.length % 8 === 3 || clean.length % 8 === 6) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits, the length RFC 4226 recommends. */
export function newSecret(): Buffer {
  return randomBytes(20);
}

export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1] & 15;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const stepAt = (timeMs: number) => Math.floor(timeMs / 1000 / STEP_SECONDS);

export function totp(secret: Buffer, timeMs: number): string {
  return hotp(secret, stepAt(timeMs));
}

/**
 * The step a typed code belongs to, or null. A step at or before `lastStep` (the last one accepted for
 * this account) is refused, so a code seen by someone watching cannot be used again within its window.
 * Every step in the window is compared, in constant time, whether or not an earlier one matched.
 */
export function verifyTotp(secret: Buffer, given: unknown, nowMs: number, lastStep: number | null): number | null {
  if (typeof given !== "string" || given.length > 32) return null;
  const typed = given.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const current = stepAt(nowMs);
  let accepted: number | null = null;
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    const matches = timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(typed));
    if (matches && (lastStep === null || step > lastStep)) accepted = step;
  }
  return accepted;
}

/** What an authenticator app reads from the QR code. */
export function otpauthUri({ secret, account, issuer }: { secret: Buffer; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
