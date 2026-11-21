/** Cram mode (ROADMAP item 48) against a real Postgres: one course's live cards, weakest first, due or not, only the caller's. */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { listCram, reviewCard } from "@/services/flashcard-service";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `cram-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});
const DAY = 86_400_000;
const setup = async (userId: string, code = "CMP") => {
  const course = await prisma.course.create({ data: { userId, code, title: "T", term: "2026" } });
  const note = await prisma.note.create({ data: { userId, title: "N", content: "x", courseId: course.id } });
  return { course, note };
};
const card = (userId: string, noteId: string | null, over: Record<string, unknown> = {}) => prisma.flashcard.create({ data: { userId, noteId, question: "Q", answer: "A", ...over } });

test("the course's cards, due or not, weakest first; other courses, other accounts and trashed notes' cards are not in it", async () => {
  const me = await newUser();
  const other = await newUser();
  const { course, note } = await setup(me);
  const { note: elsewhere } = await setup(me, "OTH");
  const future = new Date(Date.now() + 9 * DAY);
  const weak = await card(me, note.id, { dueAt: future, lastReviewed: new Date(Date.now() - DAY) });
  const fresh = await card(me, note.id, { dueAt: future });
  const easy = await card(me, note.id, { dueAt: future, lastReviewed: new Date(Date.now() - DAY), easeFactor: 2.9 });
  const hard = await card(me, note.id, { dueAt: future, lastReviewed: new Date(Date.now() - DAY), easeFactor: 1.4 });
  await card(me, elsewhere.id);
  await card(me, null);
  const trashed = await prisma.note.create({ data: { userId: me, title: "T", content: "x", courseId: course.id, deletedAt: new Date() } });
  await card(me, trashed.id);
  const { note: theirNote } = await setup(other);
  await card(other, theirNote.id);
  await prisma.cardReview.createMany({ data: [3, 2].map((d) => ({ userId: me, cardId: weak.id, grade: "again", reviewedAt: new Date(Date.now() - d * DAY) })) });

  const { items, counts } = await listCram(me, course.id, new Date());
  assert.deepEqual(items.map((i) => i.card.id), [weak.id, fresh.id, hard.id, easy.id]);
  assert.deepEqual(items.map((i) => i.entry.tier), ["weak", "new", "rest", "rest"]);
  assert.deepEqual(counts, { weak: 1, failed: 0, fresh: 1, rest: 2 });
});

test("another account's course id, an unknown id and an empty course are an empty deck", async () => {
  const me = await newUser();
  const other = await newUser();
  const { course: theirs, note } = await setup(other);
  await card(other, note.id);
  const { course: empty } = await setup(me, "EMP");
  for (const id of [theirs.id, randomUUID(), empty.id]) {
    const r = await listCram(me, id, new Date());
    assert.deepEqual([r.items.length, r.counts], [0, { weak: 0, failed: 0, fresh: 0, rest: 0 }]);
  }
});

test("grading a card in the cram deck is an ordinary review: it is rescheduled by SM-2 and the deck keeps all its cards", async () => {
  const me = await newUser();
  const { course, note } = await setup(me);
  const c = await card(me, note.id, { dueAt: new Date(Date.now() + 9 * DAY), lastReviewed: new Date(Date.now() - DAY), intervalDays: 9, repetitions: 3 });
  const before = (await listCram(me, course.id, new Date())).items.length;
  await reviewCard(me, c.id, "again");
  const after = await prisma.flashcard.findUniqueOrThrow({ where: { id: c.id } });
  assert.ok(after.dueAt.getTime() < Date.now() + DAY, "again brings it due soon, as in any review");
  assert.equal((await listCram(me, course.id, new Date())).items.length, before);
});
