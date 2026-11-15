import "server-only";
import { prisma } from "@/lib/prisma";
import { orderedPair } from "@/lib/duplicates";

/*
 * What the duplicate-note cleanup reads and writes (ROADMAP item 36). Every query is scoped by `userId`, and both the
 * notes of a pair are joined to `Note` with that same `userId` and `deletedAt IS NULL`, so a vector row left behind by a
 * note in the trash or in another account can never make a pair.
 */

/** The most notes compared with one another: the newest by last edit. Comparing every pair is quadratic, and a personal vault is far below it. */
export const MAX_COMPARED_NOTES = 2000;

export type VectorPair = { aId: string; bId: string; similarity: number };

/**
 * Pairs of the caller's live notes whose average stored vector is at least `floor` alike. The vectors are already stored, so this
 * needs no model call: with Ollama off it still answers, from whatever was indexed while it ran. A note's vector is the mean of
 * its chunks, which says what the whole note is about; the best single chunk (as link suggestions use) would call two notes
 * that merely share a paragraph alike.
 */
export function vectorPairs(userId: string, floor: number, limit: number): Promise<VectorPair[]> {
  return prisma.$queryRaw<VectorPair[]>`
    WITH notes AS (
      SELECT "id" FROM "Note"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL
      ORDER BY "updatedAt" DESC
      LIMIT ${MAX_COMPARED_NOTES}
    ),
    means AS (
      SELECT e."sourceId" AS "id", avg(e."embedding") AS "v"
      FROM "WorkspaceEmbedding" e
      JOIN notes n ON n."id" = e."sourceId"
      WHERE e."userId" = ${userId} AND e."sourceType" = 'note' AND e."embedding" IS NOT NULL
      GROUP BY e."sourceId"
    )
    SELECT a."id" AS "aId", b."id" AS "bId", 1 - (a."v" <=> b."v") AS "similarity"
    FROM means a
    JOIN means b ON a."id" < b."id"
    WHERE 1 - (a."v" <=> b."v") >= ${floor}
    ORDER BY "similarity" DESC
    LIMIT ${limit}`;
}

/**
 * Groups of live notes whose text is the same once case, spacing and punctuation are ignored, found without any vector: a note
 * pasted twice is a duplicate even if the search index never saw it. Notes of fewer than 20 characters are not compared (two
 * empty notes are not a duplicate), and a group is capped, oldest first.
 */
export async function sameTextGroups(userId: string): Promise<string[][]> {
  const rows = await prisma.$queryRaw<{ ids: string[] }[]>`
    SELECT array_agg("id" ORDER BY "createdAt", "id") AS "ids"
    FROM "Note"
    WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND length("content") >= 20
    GROUP BY md5(btrim(lower(regexp_replace("content", '[^[:alnum:]]+', ' ', 'g'))))
    HAVING count(*) > 1
    LIMIT 200`;
  return rows.map((row) => row.ids.slice(0, 20));
}

export async function decidedKeys(userId: string): Promise<Set<string>> {
  const rows = await prisma.duplicateDecision.findMany({ where: { userId }, select: { noteAId: true, noteBId: true }, take: 50_000 });
  return new Set(rows.map((row) => `${row.noteAId}|${row.noteBId}`));
}

export async function addDecision(userId: string, a: string, b: string): Promise<void> {
  const [noteAId, noteBId] = orderedPair(a, b);
  await prisma.duplicateDecision.upsert({
    where: { userId_noteAId_noteBId: { userId, noteAId, noteBId } },
    create: { userId, noteAId, noteBId },
    update: {},
  });
}

/** Everything that points at one note, moved to another of the same account. Counts of what moved. */
export async function moveChildren(userId: string, fromId: string, toId: string) {
  const [tasks, cards, attachments] = await Promise.all([
    prisma.task.updateMany({ where: { userId, noteId: fromId }, data: { noteId: toId } }),
    prisma.flashcard.updateMany({ where: { userId, noteId: fromId }, data: { noteId: toId } }),
    prisma.attachment.updateMany({ where: { userId, noteId: fromId }, data: { noteId: toId } }),
  ]);
  return { tasks: tasks.count, cards: cards.count, attachments: attachments.count };
}

/** Live notes that link to `noteId` through a stored link, and any that write `title` between brackets, for rewriting. */
export async function referrersOf(userId: string, noteId: string, title: string, take: number) {
  const trimmed = title.trim();
  const stored = await prisma.entityLink.findMany({
    where: { userId, sourceType: "note", targetType: "note", targetId: noteId },
    select: { sourceId: true },
    take,
  });
  return prisma.note.findMany({
    where: {
      userId,
      deletedAt: null,
      id: { not: noteId },
      OR: [
        { id: { in: stored.map((link) => link.sourceId) } },
        ...(trimmed ? [{ content: { contains: `[[${trimmed}`, mode: "insensitive" as const } }] : []),
      ],
    },
    take,
  });
}
