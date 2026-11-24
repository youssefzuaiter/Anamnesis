import "server-only";
import { prisma } from "@/lib/prisma";
import type { PasskeyModel as Passkey } from "@/generated/prisma/models";

export const listPasskeys = (userId: string): Promise<Passkey[]> => prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
export const countPasskeys = (userId: string): Promise<number> => prisma.passkey.count({ where: { userId } });
export const getPasskey = (userId: string, id: string): Promise<Passkey | null> => prisma.passkey.findFirst({ where: { id, userId } });
export const createPasskey = (userId: string, input: { name: string; credentialId: string; prfSalt: string }): Promise<Passkey> => prisma.passkey.create({ data: { ...input, userId } });

/** One write whose `where` is the ownership; true when a row went. */
export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  return (await prisma.passkey.deleteMany({ where: { id, userId } })).count === 1;
}
