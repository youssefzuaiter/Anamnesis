/**
 * The review log behind the stats page (ROADMAP item 39), against a real Postgres: every review of a card writes one line for its
 * owner, a review that is refused writes none, and the log is the caller's own.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { reviewCard } from "@/services/flashcard-service";

const made: string[] = [];
async function newUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: `revlog-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const card = (userId: string) => prisma.flashcard.create({ data: { userId, question: "Q", answer: "A" } });

test("each review writes one line with the card and the grade, for the card's owner", async () => {
  const me = await newUser();
  const c = await card(me);
  const before = Date.now();
  await reviewCard(me, c.id, "good");
  await reviewCard(me, c.id, "again");
  const lines = await prisma.cardReview.findMany({ where: { userId: me }, orderBy: { reviewedAt: "asc" } });
  assert.deepEqual(lines.map((line) => [line.cardId, line.grade]), [[c.id, "good"], [c.id, "again"]]);
  assert.ok(lines.every((line) => line.reviewedAt.getTime() >= before - 1000));
});

test("a review of a card that is not the caller's is refused and writes no line", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await card(other);
  await assert.rejects(() => reviewCard(me, theirs.id, "good"), { code: "RESOURCE_NOT_FOUND" });
  await assert.rejects(() => reviewCard(me, randomUUID(), "good"), { code: "RESOURCE_NOT_FOUND" });
  assert.equal(await prisma.cardReview.count({ where: { userId: { in: [me, other] } } }), 0);
});

test("deleting a card keeps the days it was reviewed on, and deleting the account deletes the log", async () => {
  const me = await newUser();
  const c = await card(me);
  await reviewCard(me, c.id, "easy");
  await prisma.flashcard.delete({ where: { id: c.id } });
  assert.equal(await prisma.cardReview.count({ where: { userId: me } }), 1);
  await prisma.user.delete({ where: { id: me } });
  assert.equal(await prisma.cardReview.count({ where: { userId: me } }), 0);
});

test("the migration's backfill gives a card that had a review date one line at that date, and a card never reviewed none", async () => {
  const sql = readFileSync("prisma/migrations/20261115160000_card_reviews/migration.sql", "utf8");
  const backfill = sql.slice(sql.indexOf('INSERT INTO "CardReview"'));
  assert.ok(backfill.startsWith("INSERT"), "the backfill is in the migration");
  const me = await newUser();
  const reviewed = await prisma.flashcard.create({ data: { userId: me, question: "Q", answer: "A", lastReviewed: new Date("2026-10-01T10:00:00Z") } });
  await card(me);
  class Rollback extends Error {}
  let seen: { cardId: string | null; grade: string | null; reviewedAt: Date }[] = [];
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(backfill);
      seen = await tx.cardReview.findMany({ where: { userId: me }, select: { cardId: true, grade: true, reviewedAt: true } });
      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
  assert.deepEqual(seen.map((line) => [line.cardId, line.grade, line.reviewedAt.toISOString()]), [[reviewed.id, null, "2026-10-01T10:00:00.000Z"]]);
  assert.equal(await prisma.cardReview.count({ where: { userId: me } }), 0, "the check left nothing behind");
});
