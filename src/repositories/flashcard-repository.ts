import "server-only";
import { prisma } from "@/lib/prisma";
import type {
  FlashcardModel as Flashcard,
  FlashcardWhereInput,
} from "@/generated/prisma/models";

export type FlashcardInput = {
  question: string;
  answer: string;
  noteId: string | null;
  /** The blank this card hides, or null for a basic card. */
  clozeIndex: number | null;
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

/**
 * The cards that count: the account's own, except those whose note is in the trash. They
 * come back when the note is restored. Every count and the queue go through this, so the
 * nav badge, Today, the deck counts and the queue always agree.
 */
function liveCards(userId: string): FlashcardWhereInput {
  return { userId, OR: [{ noteId: null }, { note: { deletedAt: null } }] };
}

/**
 * A deck is a course, the course of the card's note. "none" is every card with no note, a
 * note with no course, or a note whose course has been deleted. A course id that is not the
 * caller's matches nothing, because it is only ever used inside a query for their own cards.
 */
function deckWhere(deck: string | undefined): FlashcardWhereInput {
  if (deck === undefined) return {};
  if (deck === "none") {
    return {
      OR: [
        { noteId: null },
        { note: { OR: [{ courseId: null }, { course: { deletedAt: { not: null } } }] } },
      ],
    };
  }
  return { note: { courseId: deck, course: { deletedAt: null } } };
}

/** The review queue: everything already due, oldest due first, optionally one deck's. */
export async function listDue(
  userId: string,
  now: Date,
  options: { deck?: string; take?: number } = {},
): Promise<Flashcard[]> {
  return prisma.flashcard.findMany({
    where: { AND: [liveCards(userId), deckWhere(options.deck), { dueAt: { lte: now } }] },
    orderBy: { dueAt: "asc" },
    take: options.take ?? 50,
  });
}

export async function countDue(userId: string, now: Date): Promise<number> {
  return prisma.flashcard.count({
    where: { AND: [liveCards(userId), { dueAt: { lte: now } }] },
  });
}

/** Due cards whose note belongs to one course — through Note, since a
 *  Flashcard has no courseId of its own. */
export async function countDueForCourse(
  userId: string,
  courseId: string,
  now: Date,
): Promise<number> {
  return prisma.flashcard.count({
    where: { AND: [liveCards(userId), deckWhere(courseId), { dueAt: { lte: now } }] },
  });
}

/** The live cards of these notes (the notes of a quiz scope), oldest due first. */
export async function listForNotes(
  userId: string,
  noteIds: string[],
  limit: number,
): Promise<Flashcard[]> {
  if (noteIds.length === 0) return [];
  return prisma.flashcard.findMany({
    where: { AND: [liveCards(userId), { noteId: { in: noteIds } }] },
    orderBy: { dueAt: "asc" },
    take: limit,
  });
}

/** Every live card of the caller, oldest first, for the data export (the same rule as the queue). */
export async function listLiveForExport(userId: string): Promise<Flashcard[]> {
  return prisma.flashcard.findMany({ where: liveCards(userId), orderBy: { createdAt: "asc" } });
}

/** One card, if it is the caller's and its note is not in the trash. */
export async function getLiveCard(userId: string, cardId: string): Promise<Flashcard | null> {
  return prisma.flashcard.findFirst({ where: { AND: [liveCards(userId), { id: cardId }] } });
}

/**
 * Cards and cards due, per course. `courseId` null is the "No course" deck: no note, no
 * course on the note, or a course that has been deleted. All values are bound parameters.
 */
export async function deckCounts(
  userId: string,
  now: Date,
): Promise<{ courseId: string | null; total: number; due: number }[]> {
  return prisma.$queryRaw<{ courseId: string | null; total: number; due: number }[]>`
    SELECT c."id" AS "courseId",
           count(*)::int AS "total",
           (count(*) FILTER (WHERE f."dueAt" <= ${now}))::int AS "due"
    FROM "Flashcard" f
    LEFT JOIN "Note" n ON n."id" = f."noteId"
    LEFT JOIN "Course" c ON c."id" = n."courseId" AND c."deletedAt" IS NULL
    WHERE f."userId" = ${userId}
      AND (f."noteId" IS NULL OR n."deletedAt" IS NULL)
    GROUP BY c."id"
  `;
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
