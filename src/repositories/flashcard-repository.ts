import "server-only";
import { prisma } from "@/lib/prisma";
import { afterCreated, type ExportPage } from "@/lib/export-shape";
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

/**
 * A page of the caller's live cards for the data export (the same rule as the queue), oldest first.
 * Ties are broken by id: a card text's siblings are created in one statement and share a createdAt.
 */
export async function listLiveForExport(userId: string, page: ExportPage): Promise<Flashcard[]> {
  return prisma.flashcard.findMany({
    where: { AND: [liveCards(userId), afterCreated(page.after)] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: page.take,
  });
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

/** One line in the review log (ROADMAP item 39): the stats page counts these, since a card keeps only its latest review date. */
export async function recordReview(userId: string, cardId: string, grade: string, at: Date): Promise<void> {
  await prisma.cardReview.create({ data: { userId, cardId, grade, reviewedAt: at } });
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

/** Cards graded "again" at least `minFails` times since `since`, as ids: the candidates for the weak-spots deck (the review log, item 39). */
export async function weakCandidateIds(userId: string, since: Date, minFails: number, take: number): Promise<string[]> {
  const rows = await prisma.cardReview.groupBy({
    by: ["cardId"],
    where: { userId, grade: "again", cardId: { not: null }, reviewedAt: { gte: since } },
    having: { cardId: { _count: { gte: minFails } } },
    orderBy: { _count: { cardId: "desc" } },
    take,
  });
  return rows.flatMap((row) => (row.cardId === null ? [] : [row.cardId]));
}

/** Every graded line of these cards since `since`, for working out which are still weak. Bounded: a card is reviewed a few times a month. */
export async function reviewLinesFor(
  userId: string,
  cardIds: string[],
  since: Date,
): Promise<{ cardId: string | null; grade: string | null; reviewedAt: Date }[]> {
  if (cardIds.length === 0) return [];
  return prisma.cardReview.findMany({
    where: { userId, cardId: { in: cardIds }, reviewedAt: { gte: since } },
    select: { cardId: true, grade: true, reviewedAt: true },
    take: 50_000,
  });
}

/** The live cards among these ids (not another account's, not a trashed note's), optionally one deck's. */
export async function listLiveByIds(userId: string, ids: string[], deck?: string): Promise<Flashcard[]> {
  if (ids.length === 0) return [];
  return prisma.flashcard.findMany({
    where: { AND: [liveCards(userId), deckWhere(deck), { id: { in: ids } }] },
  });
}

/** The most card ids one search can return; a search that matches more is narrowed by its other filters or by typing more. */
export const SEARCH_ID_CAP = 5000;

/**
 * The caller's card ids whose question or answer contains `q` exactly, ignoring case. Prisma's `contains` is ILIKE and would treat `%` and `_`
 * in what was typed as wildcards, so this is `strpos` with bound parameters: what you type is what is looked for.
 */
export async function searchIdsByText(userId: string, q: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT f."id" FROM "Flashcard" f
    WHERE f."userId" = ${userId}
      AND (strpos(lower(f."question"), lower(${q})) > 0 OR strpos(lower(f."answer"), lower(${q})) > 0)
    LIMIT ${SEARCH_ID_CAP}
  `;
  return rows.map((row) => row.id);
}

export type BrowseFilter = {
  deck?: string;
  kind: "basic" | "cloze" | null;
  show: "due" | "later" | "new" | null;
  /** Restrict to these ids (a text search or the weak cards); null for no restriction. */
  ids: string[] | null;
  now: Date;
};

export type BrowseRow = Flashcard & { note: { courseId: string | null; course: { code: string; deletedAt: Date | null } | null } | null };

function browseWhere(userId: string, filter: BrowseFilter): FlashcardWhereInput {
  const and: FlashcardWhereInput[] = [liveCards(userId), deckWhere(filter.deck)];
  if (filter.kind === "basic") and.push({ clozeIndex: null });
  if (filter.kind === "cloze") and.push({ clozeIndex: { not: null } });
  if (filter.show === "due") and.push({ dueAt: { lte: filter.now } });
  if (filter.show === "later") and.push({ dueAt: { gt: filter.now } });
  if (filter.show === "new") and.push({ lastReviewed: null });
  if (filter.ids !== null) and.push({ id: { in: filter.ids } });
  return { AND: and };
}

/** One page of the caller's live cards under the filter, soonest due first, with the total that match. */
export async function browse(userId: string, filter: BrowseFilter, skip: number, take: number): Promise<{ rows: BrowseRow[]; total: number }> {
  const where = browseWhere(userId, filter);
  const [rows, total] = await Promise.all([
    prisma.flashcard.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      skip,
      take,
      include: { note: { select: { courseId: true, course: { select: { code: true, deletedAt: true } } } } },
    }),
    prisma.flashcard.count({ where }),
  ]);
  return { rows, total };
}

/** The sibling cards (same note, same text) of these fill-in-the-blank cards, for "n of m" and for editing them together. */
export async function listClozeSiblings(userId: string, noteIds: string[]): Promise<{ id: string; noteId: string | null; question: string; clozeIndex: number | null }[]> {
  if (noteIds.length === 0) return [];
  return prisma.flashcard.findMany({
    where: { AND: [liveCards(userId), { noteId: { in: noteIds }, clozeIndex: { not: null } }] },
    select: { id: true, noteId: true, question: true, clozeIndex: true },
    orderBy: [{ clozeIndex: "asc" }, { id: "asc" }],
    take: 20_000,
  });
}

/** Rewrites only the words of these cards, all or none, and only the caller's. The schedule, note and deck are not touched. */
export async function updateTexts(userId: string, updates: { id: string; question: string; answer: string }[]): Promise<number> {
  const results = await prisma.$transaction(
    updates.map((u) => prisma.flashcard.updateMany({ where: { id: u.id, userId }, data: { question: u.question, answer: u.answer } })),
  );
  return results.reduce((sum, r) => sum + r.count, 0);
}

/** A basic card of this note with exactly this question, if the caller has one, so keeping the same question twice makes one card. */
export async function findBasicByQuestion(userId: string, noteId: string, question: string): Promise<Flashcard | null> {
  return prisma.flashcard.findFirst({ where: { userId, noteId, clozeIndex: null, question } });
}

/** The most cards one cram deck reads; a course has a few hundred, so this is a guard, not a limit anyone meets. */
export const CRAM_CARD_CAP = 2000;

/** The caller's live cards of one course (the deck rule), in no particular order, for the cram ordering. */
export async function listCourseCards(userId: string, courseId: string): Promise<Flashcard[]> {
  return prisma.flashcard.findMany({
    where: { AND: [liveCards(userId), deckWhere(courseId)] },
    orderBy: { id: "asc" },
    take: CRAM_CARD_CAP,
  });
}
