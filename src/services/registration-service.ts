import "server-only";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { hashPassword } from "@/lib/password";
import { codeMatches, registrationMode, type RegistrationMode } from "@/lib/registration";

/** Any constant both callers agree on: it names the one lock that serialises account creation. */
const REGISTRATION_LOCK = 25_000_025;

/** `code` is the configured invite code (`config.REGISTRATION_CODE`), passed in so a test can say "none". */
export async function currentRegistrationMode(code: string | undefined): Promise<RegistrationMode> {
  return registrationMode(await prisma.user.count(), code);
}

export type RegistrationInput = { name: string; email: string; password: string; inviteCode: unknown };

/**
 * Creates an account if the rules allow it. The count, the check and the insert run in one
 * transaction holding an advisory lock, so two requests racing for the first account cannot both
 * see an empty table and both get in. The code is checked before the email, so someone without
 * it learns nothing about which addresses have accounts.
 */
export async function registerAccount(input: RegistrationInput, code: string | undefined) {
  const email = input.email.toLowerCase();
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK})`;
    const mode = registrationMode(await tx.user.count(), code);
    if (mode === "closed") throw new AppError("FORBIDDEN", "Registration is closed.");
    if (mode === "code" && !codeMatches(input.inviteCode, code!)) throw new AppError("FORBIDDEN", "That invite code is not right.");
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new AppError("VALIDATION_ERROR", "An account with that email already exists.");
    }
    return tx.user.create({ data: { email, name: input.name, passwordHash, profile: { create: {} } }, select: { id: true } });
  });
}
