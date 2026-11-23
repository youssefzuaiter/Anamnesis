import "server-only";
import { prisma } from "@/lib/prisma";
import type { SignatureModel as Signature } from "@/generated/prisma/models";

export function listSignatures(userId: string): Promise<Signature[]> {
  return prisma.signature.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export function countSignatures(userId: string): Promise<number> {
  return prisma.signature.count({ where: { userId } });
}

export function getSignature(userId: string, id: string): Promise<Signature | null> {
  return prisma.signature.findFirst({ where: { id, userId } });
}

export function createSignature(userId: string, input: { name: string; storageKey: string; byteSize: number; width: number; height: number }): Promise<Signature> {
  return prisma.signature.create({ data: { ...input, userId } });
}

/** Deletes one of the caller's signatures and returns it (for its file), or null when it is not theirs. The ownership is in the write itself. */
export async function deleteSignature(userId: string, id: string): Promise<Signature | null> {
  const row = await getSignature(userId, id);
  if (!row) return null;
  const { count } = await prisma.signature.deleteMany({ where: { id, userId } });
  return count === 1 ? row : null;
}
