import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, Reference } from "@/generated/prisma/client";

/** Every query here is scoped by the session's userId; writes put it in the `where` itself. */

export type ReferenceData = {
  key: string;
  type: string;
  title: string;
  authors: Prisma.InputJsonValue;
  year: number | null;
  details: Prisma.InputJsonValue;
  bibtex: string | null;
};

export function listReferences(userId: string): Promise<Reference[]> {
  return prisma.reference.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 5_000 });
}

export function getReference(userId: string, id: string): Promise<Reference | null> {
  return prisma.reference.findFirst({ where: { id, userId } });
}

export function referencesByKeys(userId: string, keys: string[]): Promise<Reference[]> {
  if (keys.length === 0) return Promise.resolve([]);
  return prisma.reference.findMany({ where: { userId, key: { in: keys } } });
}

export function createReference(userId: string, data: ReferenceData): Promise<Reference> {
  return prisma.reference.create({ data: { ...data, userId } });
}

export function createReferences(userId: string, rows: ReferenceData[]): Promise<{ count: number }> {
  return prisma.reference.createMany({ data: rows.map((row) => ({ ...row, userId })), skipDuplicates: true });
}

/** Updates the caller's reference; false when there is none with that id. */
export async function updateReference(userId: string, id: string, data: ReferenceData): Promise<boolean> {
  const { count } = await prisma.reference.updateMany({ where: { id, userId }, data });
  return count === 1;
}

export async function deleteReference(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.reference.deleteMany({ where: { id, userId } });
  return count === 1;
}

/** Live notes whose text contains `text` literally (strpos, never LIKE), newest first. */
export function notesContaining(userId: string, text: string, take: number): Promise<{ id: string; title: string; content: string }[]> {
  return prisma.$queryRaw<{ id: string; title: string; content: string }[]>`
    SELECT "id", "title", "content"
    FROM "Note"
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND strpos("content", ${text}) > 0
    ORDER BY "updatedAt" DESC
    LIMIT ${take}`;
}
