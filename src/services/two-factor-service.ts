import "server-only";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { AppError } from "@/lib/api-response";
import { verifyPassword } from "@/lib/password";
import { base32Encode, newSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { open, seal } from "@/lib/secret-box";
import { hashRecoveryCode, looksLikeRecoveryCode, newRecoveryCodes } from "@/lib/recovery-codes";
import { qrSvg } from "@/lib/qr";
import { clearAttempts, isRateLimited, minutesUntilReset, registerFailedAttempt } from "@/lib/rate-limit";

const ISSUER = "Anamnesis";
const ALREADY_ON = "Two-factor sign-in is already on.";

export async function twoFactorStatus(userId: string) {
  const [user, left] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } }),
    prisma.recoveryCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabled: Boolean(user?.totpEnabledAt), recoveryCodesLeft: left };
}

/**
 * Makes a new key and stores it sealed, not yet in force: sign-in asks for a code only once setup is
 * confirmed, so an abandoned setup locks nobody out. Beginning again replaces the pending key.
 */
export async function beginSetup(userId: string, account: string) {
  const secret = newSecret();
  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpEnabledAt: null },
    data: { totpSecret: seal(secret, config.NEXTAUTH_SECRET) },
  });
  if (count === 0) throw new AppError("VALIDATION_ERROR", ALREADY_ON);
  const uri = otpauthUri({ secret, account, issuer: ISSUER });
  return {
    secret: base32Encode(secret).match(/.{1,4}/g)!.join(" "),
    uri,
    qrSvg: qrSvg(uri, "Setup code for your authenticator app"),
  };
}

/** Turns two-factor on when the person proves the app has the key; returns the recovery codes, once. */
export async function confirmSetup(userId: string, code: unknown, now: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true } });
  if (user?.totpEnabledAt) throw new AppError("VALIDATION_ERROR", ALREADY_ON);
  const secret = user?.totpSecret ? open(user.totpSecret, config.NEXTAUTH_SECRET) : null;
  if (!user?.totpSecret || !secret) throw new AppError("VALIDATION_ERROR", "Start setup first.");
  const step = verifyTotp(secret, code, now, null);
  if (step === null) throw new AppError("VALIDATION_ERROR", "That code is not right.");

  const recoveryCodes = newRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    // Only if the key is still the one that was just checked: a second tab that began setup again
    // replaced it, and this confirmation must not turn on a key the person never scanned.
    const { count } = await tx.user.updateMany({
      where: { id: userId, totpEnabledAt: null, totpSecret: user.totpSecret },
      data: { totpEnabledAt: new Date(), totpLastStep: step },
    });
    if (count === 0) throw new AppError("VALIDATION_ERROR", "Setup changed in another tab. Start setup again.");
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({ data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })) });
  });
  return { recoveryCodes };
}

/**
 * The second factor at sign-in, after the password. True when the account has none, or when `given` is a
 * current authenticator code (each 30-second step once) or an unused recovery code (once). Used up with a
 * conditional update, so two requests with the same code cannot both pass.
 */
export async function checkSecondFactor(userId: string, given: unknown, now: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true },
  });
  if (!user) return false;
  if (!user.totpEnabledAt) return true;

  if (looksLikeRecoveryCode(given)) {
    const { count } = await prisma.recoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(given), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  // A key that cannot be opened (the app secret changed) refuses codes; recovery codes still work.
  const secret = user.totpSecret ? open(user.totpSecret, config.NEXTAUTH_SECRET) : null;
  if (!secret) return false;
  const step = verifyTotp(secret, given, now, user.totpLastStep);
  if (step === null) return false;
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return count === 1;
}

/** Password and a code, for the changes that would let someone at an unlocked screen weaken the account. */
async function verifyForChange(userId: string, password: unknown, code: unknown, now: number) {
  const key = `two-factor:${userId}`;
  if (isRateLimited(key)) {
    const minutes = minutesUntilReset(key);
    throw new AppError("RATE_LIMITED", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, totpEnabledAt: true } });
  if (!user?.totpEnabledAt) throw new AppError("VALIDATION_ERROR", "Two-factor sign-in is not on.");
  const ok = typeof password === "string" && (await verifyPassword(password, user.passwordHash)) && (await checkSecondFactor(userId, code, now));
  if (!ok) {
    registerFailedAttempt(key);
    throw new AppError("FORBIDDEN", "Incorrect password or code.");
  }
  clearAttempts(key);
}

export async function disableTwoFactor(userId: string, password: unknown, code: unknown, now: number) {
  await verifyForChange(userId, password, code, now);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
  ]);
}

export async function regenerateRecoveryCodes(userId: string, password: unknown, code: unknown, now: number) {
  await verifyForChange(userId, password, code, now);
  const recoveryCodes = newRecoveryCodes();
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })) }),
  ]);
  return { recoveryCodes };
}
