import "server-only";
import { prisma } from "@/lib/prisma";

/*
 * What the stats page reads (ROADMAP item 39): only timestamps, never the text of anything, and every query is scoped by `userId`.
 * Each read is bounded (`take`), so an account with a very long history cannot make the page read it all; the newest rows are kept.
 */

const TAKE = 50_000;

export function listTaskCompletions(userId: string, since: Date, until: Date): Promise<{ completedAt: Date | null }[]> {
  // A task finished and later deleted is still a day it was finished: the deleted ones are counted on purpose.
  return prisma.task.findMany({
    where: { userId, completedAt: { gte: since, lt: until } },
    select: { completedAt: true },
    orderBy: { completedAt: "desc" },
    take: TAKE,
  });
}

export function listCardReviews(userId: string, since: Date, until: Date): Promise<{ reviewedAt: Date }[]> {
  return prisma.cardReview.findMany({
    where: { userId, reviewedAt: { gte: since, lt: until } },
    select: { reviewedAt: true },
    orderBy: { reviewedAt: "desc" },
    take: TAKE,
  });
}

export function listStudySessions(userId: string, since: Date, until: Date): Promise<{ recordedAt: Date; seconds: number }[]> {
  return prisma.studySession.findMany({
    where: { userId, recordedAt: { gte: since, lt: until } },
    select: { recordedAt: true, seconds: true },
    orderBy: { recordedAt: "desc" },
    take: TAKE,
  });
}

/** When the review log starts for this account (null before the first review). */
export async function firstCardReview(userId: string): Promise<Date | null> {
  const row = await prisma.cardReview.findFirst({ where: { userId }, orderBy: { reviewedAt: "asc" }, select: { reviewedAt: true } });
  return row?.reviewedAt ?? null;
}
