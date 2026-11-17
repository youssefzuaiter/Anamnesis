/**
 * The weak-spots deck (ROADMAP item 42) against a real Postgres: cards failed twice in 30 days and not mended since, only the caller's own live
 * cards, from the review log. Reviews are written straight into the log so the days are exact.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { listWeakSpots, reviewCard } from "@/services/flashcard-service";
import { weakCandidateIds, reviewLinesFor } from "@/repositories/flashcard-repository";

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `weak-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const card = (userId: string, over: Record<string, unknown> = {}) => prisma.flashcard.create({ data: { userId, question: "Q?", answer: "A", ...over } });
const log = (userId: string, cardId: string | null, grades: [string | null, number][]) =>
  prisma.cardReview.createMany({ data: grades.map(([grade, d]) => ({ userId, cardId, grade, reviewedAt: daysAgo(d) })) });
// `now` is taken when asked, as a page does: a review the test just made is never later than it.
const ids = async (userId: string, deck?: string) => (await listWeakSpots(userId, new Date(), deck)).map((w) => w.card.id);

test("a card failed twice in 30 days is in the deck, worst first; one failure is not", async () => {
  const me = await newUser();
  const twice = await card(me);
  const thrice = await card(me);
  const once = await card(me);
  await log(me, twice.id, [["again", 5], ["again", 4]]);
  await log(me, thrice.id, [["again", 9], ["again", 7], ["again", 1]]);
  await log(me, once.id, [["again", 2], ["good", 1]]);
  const weak = await listWeakSpots(me, new Date());
  assert.deepEqual(weak.map((w) => [w.card.id, w.fails]), [[thrice.id, 3], [twice.id, 2]]);
});

test("two good answers since the failures mend a card, and it leaves the deck", async () => {
  const me = await newUser();
  const c = await card(me);
  await log(me, c.id, [["again", 9], ["again", 8], ["good", 3], ["easy", 1]]);
  assert.deepEqual(await ids(me), []);
  const d = await card(me);
  await log(me, d.id, [["again", 9], ["again", 8], ["good", 3], ["hard", 1]]);
  assert.deepEqual(await ids(me), [d.id]);
});

test("grading in the app moves a card in and out of the deck, through the ordinary review", async () => {
  const me = await newUser();
  const c = await card(me);
  await reviewCard(me, c.id, "again");
  assert.deepEqual(await ids(me), []);
  await reviewCard(me, c.id, "again");
  assert.deepEqual(await ids(me), [c.id]);
  await reviewCard(me, c.id, "good");
  assert.deepEqual(await ids(me), [c.id], "one good answer is not enough");
  await reviewCard(me, c.id, "easy");
  assert.deepEqual(await ids(me), []);
});

test("failures older than 30 days, and lines with no grade, do not count", async () => {
  const me = await newUser();
  const old = await card(me);
  await log(me, old.id, [["again", 40], ["again", 35], ["again", 3]]);
  const ungraded = await card(me);
  await log(me, ungraded.id, [[null, 2], [null, 1], ["again", 1]]);
  assert.deepEqual(await ids(me), []);
});

test("a card whose note is in the trash is not offered, and comes back with the note", async () => {
  const me = await newUser();
  const note = await prisma.note.create({ data: { userId: me, title: "N", content: "x", tags: [] } });
  const c = await card(me, { noteId: note.id });
  await log(me, c.id, [["again", 3], ["again", 2]]);
  assert.deepEqual(await ids(me), [c.id]);
  await prisma.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
  assert.deepEqual(await ids(me), []);
  await prisma.note.update({ where: { id: note.id }, data: { deletedAt: null } });
  assert.deepEqual(await ids(me), [c.id]);
});

test("a deleted card leaves nothing behind, and a deck keeps only its own course's cards", async () => {
  const me = await newUser();
  const gone = await card(me);
  await log(me, gone.id, [["again", 3], ["again", 2]]);
  await prisma.flashcard.delete({ where: { id: gone.id } });
  assert.deepEqual(await ids(me), []);

  const course = await prisma.course.create({ data: { userId: me, code: "CMP1", title: "T", term: "F" } });
  const note = await prisma.note.create({ data: { userId: me, title: "N", content: "x", tags: [], courseId: course.id } });
  const inCourse = await card(me, { noteId: note.id });
  const loose = await card(me);
  for (const c of [inCourse, loose]) await log(me, c.id, [["again", 3], ["again", 2]]);
  assert.deepEqual((await ids(me)).sort(), [inCourse.id, loose.id].sort());
  assert.deepEqual(await ids(me, course.id), [inCourse.id]);
  assert.deepEqual(await ids(me, "none"), [loose.id]);
});

test("another account's reviews and cards never reach my deck, even naming my card's id", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await card(me);
  const theirs = await card(other);
  await log(other, theirs.id, [["again", 3], ["again", 2]]);
  await log(other, mine.id, [["again", 3], ["again", 2]]); // their log line naming my card
  assert.deepEqual(await ids(me), [], "their failures do not make my card weak");
  assert.deepEqual(await ids(other), [theirs.id], "their own card is theirs, and my card, named in their log, is not offered to them");
  await log(other, null, [["again", 1], ["again", 1]]);
  assert.deepEqual(await ids(other), [theirs.id], "lines with no card change nothing");
});

test("the two log reads are scoped to the caller on their own (the service would mask a missing filter)", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await card(me);
  await log(other, mine.id, [["again", 3], ["again", 2]]); // another account's log lines, naming my card
  await log(me, mine.id, [["good", 1]]);
  const since = new Date(NOW.getTime() - 30 * 86_400_000);
  assert.deepEqual(await weakCandidateIds(me, since, 2, 500), [], "their failures are not my candidates");
  assert.deepEqual(await weakCandidateIds(other, since, 2, 500), [mine.id], "they are theirs");
  const lines = await reviewLinesFor(me, [mine.id], since);
  assert.deepEqual(lines.map((l) => l.grade), ["good"], "only my own line comes back");
  assert.deepEqual(await reviewLinesFor(me, [], since), []);
});
