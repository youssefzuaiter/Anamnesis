/**
 * The card browser (ROADMAP item 47) against a real Postgres: exact-text search (a % or _ is a letter, not a wildcard), the filters, pages, only the
 * caller's live cards, and editing words without touching the schedule, with a fill-in-the-blank text rewritten across its blanks together.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { browseCards, editCard } from "@/services/flashcard-service";
import { parseBrowseParams, BROWSE_PAGE_SIZE } from "@/lib/card-browser";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `browse-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const card = (userId: string, over: Record<string, unknown> = {}) => prisma.flashcard.create({ data: { userId, question: "Q?", answer: "A", ...over } });
const params = (raw: Record<string, string>) => parseBrowseParams(raw);
const browse = (userId: string, raw: Record<string, string> = {}) => browseCards(userId, params(raw), new Date());
const idsOf = async (userId: string, raw: Record<string, string> = {}) => (await browse(userId, raw)).cards.map((c) => c.card.id).sort();

test("search is exact text in the question or the answer, ignoring case; % and _ are letters", async () => {
  const me = await newUser();
  const a = await card(me, { question: "What is 100% of 50?", answer: "50" });
  const b = await card(me, { question: "Name the snake_case style", answer: "lower_with_underscores" });
  const c = await card(me, { question: "Capital of France", answer: "PARIS" });
  const d = await card(me, { question: "Something else entirely", answer: "none" });
  assert.deepEqual(await idsOf(me, { q: "paris" }), [c.id]);
  assert.deepEqual(await idsOf(me, { q: "100%" }), [a.id]);
  assert.deepEqual(await idsOf(me, { q: "%" }), [a.id], "a lone % matches only the card that has one");
  assert.deepEqual(await idsOf(me, { q: "_" }), [b.id].sort(), "a lone _ matches only cards with an underscore");
  assert.deepEqual(await idsOf(me, { q: "n_k" }), [], "an underscore is not 'any one letter' (n_k would match 'nak' in snake)");
  assert.deepEqual(await idsOf(me, { q: "' OR 1=1 --" }), []);
  assert.equal((await browse(me)).total, 4);
  void d;
});

test("only my own live cards: another account's cards and cards of a trashed note never show", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await card(me, { question: "shared words" });
  await card(other, { question: "shared words" });
  const note = await prisma.note.create({ data: { userId: me, title: "Trashed", content: "x", deletedAt: new Date() } });
  await card(me, { question: "shared words", noteId: note.id });
  assert.deepEqual(await idsOf(me, { q: "shared words" }), [mine.id]);
  assert.equal((await browse(me)).total, 1);
});

test("the kind, the state and the deck filters", async () => {
  const me = await newUser();
  const course = await prisma.course.create({ data: { userId: me, code: "CMP2003", title: "Algorithms", term: "2026" } });
  const note = await prisma.note.create({ data: { userId: me, title: "N", content: "x", courseId: course.id } });
  const now = Date.now();
  const due = await card(me, { dueAt: new Date(now - 3600_000), lastReviewed: new Date(now - 86_400_000), noteId: note.id });
  const later = await card(me, { dueAt: new Date(now + 5 * 86_400_000), lastReviewed: new Date(now - 86_400_000) });
  const fresh = await card(me, { dueAt: new Date(now - 7200_000) });
  const text = "The {{c1::cat}} sat on the {{c2::mat}}";
  const bare = await prisma.note.create({ data: { userId: me, title: "No course", content: "x" } });
  const cl1 = await card(me, { question: text, answer: "cat", clozeIndex: 1, noteId: bare.id, dueAt: new Date(now + 86_400_000) });
  const cl2 = await card(me, { question: text, answer: "mat", clozeIndex: 2, noteId: bare.id, dueAt: new Date(now + 86_400_000) });
  assert.deepEqual(await idsOf(me, { show: "due" }), [due.id, fresh.id].sort());
  assert.deepEqual(await idsOf(me, { show: "later" }), [later.id, cl1.id, cl2.id].sort());
  assert.deepEqual(await idsOf(me, { show: "new" }), [fresh.id, cl1.id, cl2.id].sort());
  assert.deepEqual(await idsOf(me, { kind: "cloze" }), [cl1.id, cl2.id].sort());
  assert.deepEqual(await idsOf(me, { kind: "basic" }), [due.id, later.id, fresh.id].sort());
  assert.deepEqual(await idsOf(me, { deck: course.id }), [due.id]);
  assert.deepEqual(await idsOf(me, { deck: "none" }), [later.id, fresh.id, cl1.id, cl2.id].sort());
  assert.deepEqual(await idsOf(me, { deck: randomUUID() }), [], "another account's or unknown deck matches nothing");
  const row = (await browse(me, { deck: course.id })).cards[0];
  assert.equal(row.courseCode, "CMP2003");
  const clozeRow = (await browse(me, { kind: "cloze" })).cards[0];
  assert.equal(clozeRow.siblingCount, 2);
});

test("the weak filter lists the failed cards with how often", async () => {
  const me = await newUser();
  const weak = await card(me);
  await card(me);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  await prisma.cardReview.createMany({ data: [{ userId: me, cardId: weak.id, grade: "again", reviewedAt: day(3) }, { userId: me, cardId: weak.id, grade: "again", reviewedAt: day(2) }] });
  const r = await browse(me, { show: "weak" });
  assert.deepEqual(r.cards.map((c) => [c.card.id, c.fails]), [[weak.id, 2]]);
  assert.equal(r.total, 1);
});

test("pages of 50, in due order; a page past the end is the last page", async () => {
  const me = await newUser();
  const base = Date.now() - 100 * 60_000;
  await prisma.flashcard.createMany({ data: Array.from({ length: BROWSE_PAGE_SIZE + 3 }, (_, i) => ({ userId: me, question: `Q${i}`, answer: "A", dueAt: new Date(base + i * 60_000) })) });
  const first = await browse(me);
  assert.equal(first.cards.length, BROWSE_PAGE_SIZE);
  assert.equal(first.total, BROWSE_PAGE_SIZE + 3);
  assert.equal(first.pages, 2);
  assert.equal(first.cards[0].card.question, "Q0");
  const second = await browse(me, { page: "2" });
  assert.deepEqual(second.cards.map((c) => c.card.question), ["Q50", "Q51", "Q52"]);
  const past = await browse(me, { page: "9" });
  assert.equal(past.page, 2);
  assert.equal(past.cards.length, 3);
  const empty = await browse(await newUser());
  assert.deepEqual([empty.cards.length, empty.total, empty.page, empty.pages], [0, 0, 1, 1]);
});

test("editing a basic card changes its words and nothing else", async () => {
  const me = await newUser();
  const note = await prisma.note.create({ data: { userId: me, title: "N", content: "x" } });
  const reviewed = new Date(Date.now() - 86_400_000);
  const c = await card(me, { noteId: note.id, easeFactor: 2.1, intervalDays: 6, repetitions: 3, dueAt: new Date(Date.now() + 5 * 86_400_000), lastReviewed: reviewed });
  const before = await prisma.flashcard.findUniqueOrThrow({ where: { id: c.id } });
  assert.deepEqual(await editCard(me, c.id, { question: " New question? ", answer: " New answer " }), { changed: 1 });
  const after = await prisma.flashcard.findUniqueOrThrow({ where: { id: c.id } });
  assert.deepEqual([after.question, after.answer], ["New question?", "New answer"]);
  assert.deepEqual({ ...after, question: before.question, answer: before.answer }, before);
});

test("editing one blank's card rewrites all the cards of that text, each with its own answer", async () => {
  const me = await newUser();
  const note = await prisma.note.create({ data: { userId: me, title: "N", content: "x" } });
  const text = "The {{c1::cat}} sat on the {{c2::mat}}";
  const other = "Other {{c1::thing}}";
  const a = await card(me, { noteId: note.id, question: text, answer: "cat", clozeIndex: 1, repetitions: 4 });
  const b = await card(me, { noteId: note.id, question: text, answer: "mat", clozeIndex: 2, repetitions: 2 });
  const x = await card(me, { noteId: note.id, question: other, answer: "thing", clozeIndex: 1 });
  const next = "The {{c1::dog}} sat on the {{c2::rug}}";
  assert.deepEqual(await editCard(me, b.id, { text: next }), { changed: 2 });
  const rows = await prisma.flashcard.findMany({ where: { id: { in: [a.id, b.id, x.id] } }, orderBy: { id: "asc" } });
  const get = (id: string) => rows.find((r) => r.id === id)!;
  assert.deepEqual([get(a.id).question, get(a.id).answer, get(a.id).repetitions], [next, "dog", 4]);
  assert.deepEqual([get(b.id).question, get(b.id).answer, get(b.id).repetitions], [next, "rug", 2]);
  assert.deepEqual([get(x.id).question, get(x.id).answer], [other, "thing"], "another text of the same note is untouched");
});

test("changing the blanks, an invalid text or an over-long card is refused and writes nothing", async () => {
  const me = await newUser();
  const note = await prisma.note.create({ data: { userId: me, title: "N", content: "x" } });
  const text = "The {{c1::cat}} sat on the {{c2::mat}}";
  const a = await card(me, { noteId: note.id, question: text, answer: "cat", clozeIndex: 1 });
  const b = await card(me, { noteId: note.id, question: text, answer: "mat", clozeIndex: 2 });
  const basic = await card(me, { question: "Q", answer: "A" });
  const refused = async (id: string, input: Record<string, unknown>, code: string) =>
    assert.rejects(editCard(me, id, input), (e: { code?: string }) => e.code === code, JSON.stringify(input).slice(0, 50));
  await refused(a.id, { text: `${text} and {{c3::more}}` }, "VALIDATION_ERROR");
  await refused(a.id, { text: "Only {{c1::one}}" }, "VALIDATION_ERROR");
  await refused(a.id, { text: "no blanks" }, "VALIDATION_ERROR");
  await refused(a.id, { question: "Q", answer: "A" }, "VALIDATION_ERROR");
  await refused(basic.id, { question: "", answer: "A" }, "VALIDATION_ERROR");
  await refused(basic.id, { question: "x".repeat(1001), answer: "A" }, "VALIDATION_ERROR");
  await refused(basic.id, { text }, "VALIDATION_ERROR");
  const rows = await prisma.flashcard.findMany({ where: { id: { in: [a.id, b.id, basic.id] } } });
  assert.deepEqual(rows.map((r) => r.question).sort(), [text, text, "Q"].sort());
});

test("another account's card, a trashed note's card and an unknown id cannot be edited", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await card(other, { question: "theirs" });
  const note = await prisma.note.create({ data: { userId: me, title: "T", content: "x", deletedAt: new Date() } });
  const trashed = await card(me, { question: "trashed", noteId: note.id });
  for (const id of [theirs.id, trashed.id, randomUUID()]) {
    await assert.rejects(editCard(me, id, { question: "hijack", answer: "x" }), (e: { code?: string }) => e.code === "RESOURCE_NOT_FOUND");
  }
  assert.equal((await prisma.flashcard.findUniqueOrThrow({ where: { id: theirs.id } })).question, "theirs");
  assert.equal((await prisma.flashcard.findUniqueOrThrow({ where: { id: trashed.id } })).question, "trashed");
});
