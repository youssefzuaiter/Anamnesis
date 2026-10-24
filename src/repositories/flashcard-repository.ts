import "server-only";
import { prisma } from "@/lib/prisma";
import type { FlashcardModel as Flashcard } from "@/generated/prisma/models";

export type FlashcardInput = {
  question: string;
  answer: string;
  noteId: string | null;
};

export async function createCards(
  userId: string,
  cards: FlashcardInput[],
): Promise<number> {
  const { count } = await prisma.flashcard.createMany({
    data: cards.map((card) => ({ ...card, userId })),
  });
  return count;
}

/** The review queue: everything already due, oldest due first. */
export async function listDue(
  userId: string,
  now: Date,
  take = 50,
): Promise<Flashcard[]> {
  return prisma.flashcard.findMany({
    where: { userId, dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
    take,
  });
}

export async function countCards(
  userId: string,
  now: Date,
): Promise<{ total: number; due: number }> {
  const [total, due] = await Promise.all([
    prisma.flashcard.count({ where: { userId } }),
    prisma.flashcard.count({ where: { userId, dueAt: { lte: now } } }),
  ]);
  return { total, due };
}

export async function countDue(userId: string, now: Date): Promise<number> {
  return prisma.flashcard.count({ where: { userId, dueAt: { lte: now } } });
}

/** Due cards whose note belongs to one course — through Note, since a
 *  Flashcard has no courseId of its own. */
export async function countDueForCourse(
  userId: string,
  courseId: string,
  now: Date,
): Promise<number> {
  return prisma.flashcard.count({
    where: { userId, dueAt: { lte: now }, note: { courseId, deletedAt: null } },
  });
}

export async function listForNote(
  userId: string,
  noteId: string,
): Promise<Flashcard[]> {
  return prisma.flashcard.findMany({
    where: { userId, noteId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getCard(
  userId: string,
  cardId: string,
): Promise<Flashcard | null> {
  return prisma.flashcard.findFirst({ where: { id: cardId, userId } });
}

export async function applyReview(
  userId: string,
  cardId: string,
  state: {
    easeFactor: number;
    intervalDays: number;
    repetitions: number;
    dueAt: Date;
  },
): Promise<boolean> {
  const { count } = await prisma.flashcard.updateMany({
    where: { id: cardId, userId },
    data: { ...state, lastReviewed: new Date() },
  });
  return count > 0;
}

export async function deleteCard(
  userId: string,
  cardId: string,
): Promise<boolean> {
  const { count } = await prisma.flashcard.deleteMany({
    where: { id: cardId, userId },
  });
  return count > 0;
}
