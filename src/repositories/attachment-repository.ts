import "server-only";
import { prisma } from "@/lib/prisma";
import type { AttachmentModel as Attachment } from "@/generated/prisma/models";

export async function listForNote(
  userId: string,
  noteId: string,
): Promise<Attachment[]> {
  return prisma.attachment.findMany({
    where: { userId, noteId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getAttachmentRow(
  userId: string,
  attachmentId: string,
): Promise<Attachment | null> {
  return prisma.attachment.findFirst({ where: { id: attachmentId, userId } });
}

export async function createAttachment(
  userId: string,
  input: {
    noteId: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    storageKey: string;
  },
): Promise<Attachment> {
  return prisma.attachment.create({ data: { ...input, userId } });
}

export async function deleteAttachmentRow(
  userId: string,
  attachmentId: string,
): Promise<Attachment | null> {
  const row = await getAttachmentRow(userId, attachmentId);
  if (!row) return null;
  await prisma.attachment.delete({ where: { id: row.id } });
  return row;
}

/** The caller's attachment records on live notes, oldest first. No bytes: those are on disk. */
export async function listForVault(userId: string): Promise<Attachment[]> {
  return prisma.attachment.findMany({
    where: { userId, note: { deletedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** How many attachments the caller has on live notes and how many bytes they come to. */
export async function vaultTotals(userId: string): Promise<{ count: number; bytes: number }> {
  const total = await prisma.attachment.aggregate({
    where: { userId, note: { deletedAt: null } },
    _count: { _all: true },
    _sum: { byteSize: true },
  });
  return { count: total._count._all, bytes: total._sum.byteSize ?? 0 };
}
