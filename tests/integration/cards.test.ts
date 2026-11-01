/**
 * Fill-in-the-blank cards and per-course decks against a real Postgres, DB-only like the
 * rest of this tier. What a pure test cannot check: another account's note never taking a
 * card, a deck never showing another account's cards, and a trashed note's cards leaving
 * every count and the queue together.
 *
 * Each test makes its own accounts so one test's cards cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import { createCardsForNote, listDecks } from "@/services/flashcard-service";

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `cards-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const NOW = new Date();
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000);
const TOMORROW = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

const course = (userId: string, code: string, deleted = false) =>
  prisma.course.create({
    data: {
      userId,
      code,
      title: `Title of ${code}`,
      term: "Fall 2026",
      deletedAt: deleted ? new Date() : null,
    },
  });

const note = (userId: string, courseId: string | null = null, deleted = false) =>
  prisma.note.create({
    data: {
      userId,
      courseId,
      title: `Note ${randomUUID()}`,
      content: "Some text.",
      deletedAt: deleted ? new Date() : null,
    },
  });

const card = (userId: string, noteId: string | null, dueAt: Date = PAST, question = `Q ${randomUUID()}`) =>
  prisma.flashcard.create({ data: { userId, noteId, question, answer: "A", dueAt } });

const cardRows = (userId: string) =>
  prisma.flashcard.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await assert.rejects(promise, (error) => error instanceof AppError && error.code === code);
}

test("the new column exists and is optional", async () => {
  const user = await newUser();
  const n = await note(user.id);
  const basic = await card(user.id, n.id);
  assert.equal(basic.clozeIndex, null);
  const cloze = await prisma.flashcard.update({ where: { id: basic.id }, data: { clozeIndex: 2 } });
  assert.equal(cloze.clozeIndex, 2);
});

test("a basic card is stored trimmed, with no cloze index", async () => {
  const user = await newUser();
  const n = await note(user.id);

  const result = await createCardsForNote(user.id, n.id, {
    kind: "basic",
    question: "  What is ATP?  ",
    answer: " The energy currency. ",
  });

  assert.deepEqual(result, { created: 1 });
  const rows = await cardRows(user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].question, "What is ATP?");
  assert.equal(rows[0].answer, "The energy currency.");
  assert.equal(rows[0].clozeIndex, null);
  assert.equal(rows[0].noteId, n.id);
});

test("a cloze text makes one card per distinct number, each holding the whole text", async () => {
  const user = await newUser();
  const n = await note(user.id);
  const text = "{{c1::Mitochondria}} make {{c2::ATP}} in the {{c1::cell}}";

  const result = await createCardsForNote(user.id, n.id, { kind: "cloze", text: `  ${text}  ` });

  assert.deepEqual(result, { created: 2 });
  const rows = (await cardRows(user.id)).sort((a, b) => (a.clozeIndex ?? 0) - (b.clozeIndex ?? 0));
  assert.deepEqual(rows.map((r) => r.clozeIndex), [1, 2]);
  assert.deepEqual(rows.map((r) => r.question), [text, text]);
  assert.deepEqual(rows.map((r) => r.answer), ["Mitochondria, cell", "ATP"]);
  assert.ok(rows.every((r) => r.noteId === n.id));
});

test("a bad cloze text or a bad basic card writes nothing", async () => {
  const user = await newUser();
  const n = await note(user.id);

  const bad = [
    { kind: "cloze", text: "" },
    { kind: "cloze", text: "No blanks here" },
    { kind: "cloze", text: "{{c1::a" },
    { kind: "cloze", text: "{{c1:: }}" },
    { kind: "cloze", text: Array.from({ length: 11 }, (_, i) => `{{c${i + 1}::a}}`).join(" ") },
    { kind: "cloze", text: `{{c1::a}}${"x".repeat(2001)}` },
    { kind: "basic", question: "", answer: "A" },
    { kind: "basic", question: "   ", answer: "A" },
    { kind: "basic", question: "q".repeat(1001), answer: "A" },
    { kind: "basic", question: "Q", answer: "" },
    { kind: "basic", question: "Q", answer: "a".repeat(2001) },
  ] as const;

  for (const input of bad) {
    await expectCode(createCardsForNote(user.id, n.id, input), "VALIDATION_ERROR");
  }
  assert.equal(await prisma.flashcard.count({ where: { userId: user.id } }), 0);
});

test("another account's note, a trashed note and a missing note are the same refusal", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  const foreign = await note(theirs.id);
  const trashed = await note(mine.id, null, true);
  const input = { kind: "basic", question: "Q", answer: "A" } as const;

  for (const noteId of [foreign.id, trashed.id, randomUUID()]) {
    await assert.rejects(createCardsForNote(mine.id, noteId, input), (error) => {
      return (
        error instanceof AppError &&
        error.code === "RESOURCE_NOT_FOUND" &&
        error.message === "That note no longer exists."
      );
    });
  }
  assert.equal(await prisma.flashcard.count({ where: { userId: { in: [mine.id, theirs.id] } } }), 0);

  // Bad input with a foreign id says only that the input is bad: it reveals nothing.
  await expectCode(
    createCardsForNote(mine.id, foreign.id, { kind: "basic", question: "", answer: "A" }),
    "VALIDATION_ERROR",
  );
});

test("the deck filter takes a course id, none, and a course that is not yours", async () => {
  const user = await newUser();
  const other = await newUser();
  const a = await course(user.id, "AAA1000");
  const b = await course(user.id, "BBB1000");
  const theirs = await course(other.id, "CCC1000");
  const inA = await card(user.id, (await note(user.id, a.id)).id, new Date(PAST.getTime() - 3000));
  const inB = await card(user.id, (await note(user.id, b.id)).id, new Date(PAST.getTime() - 2000));
  const loose = await card(user.id, (await note(user.id)).id, new Date(PAST.getTime() - 1000));
  await card(other.id, (await note(other.id, theirs.id)).id);

  const ids = async (deck?: string) =>
    (await flashcardRepository.listDue(user.id, NOW, { deck })).map((c) => c.id);

  assert.deepEqual(await ids(a.id), [inA.id]);
  assert.deepEqual(await ids(b.id), [inB.id]);
  assert.deepEqual(await ids("none"), [loose.id]);
  assert.deepEqual(await ids(theirs.id), []);
  assert.deepEqual(await ids(randomUUID()), []);
  assert.deepEqual(await ids(), [inA.id, inB.id, loose.id]); // oldest due first
});

test("a card whose note is in a deleted course is in no course", async () => {
  const user = await newUser();
  const gone = await course(user.id, "OLD1000", true);
  const orphan = await card(user.id, (await note(user.id, gone.id)).id);

  const ids = async (deck: string) =>
    (await flashcardRepository.listDue(user.id, NOW, { deck })).map((c) => c.id);
  assert.deepEqual(await ids("none"), [orphan.id]);
  assert.deepEqual(await ids(gone.id), []);
  assert.deepEqual(await flashcardRepository.deckCounts(user.id, NOW), [
    { courseId: null, total: 1, due: 1 },
  ]);
});

test("a card with no note is in no course", async () => {
  const user = await newUser();
  const free = await card(user.id, null);
  const ids = (await flashcardRepository.listDue(user.id, NOW, { deck: "none" })).map((c) => c.id);
  assert.deepEqual(ids, [free.id]);
});

test("deckCounts counts per course for one account only, and due means due now", async () => {
  const mine = await newUser();
  const other = await newUser();
  const a = await course(mine.id, "AAA1000");
  const theirA = await course(other.id, "AAA1000");
  const inA = (await note(mine.id, a.id)).id;
  await card(mine.id, inA);
  await card(mine.id, inA);
  await card(mine.id, inA, TOMORROW);
  await card(mine.id, (await note(mine.id)).id);
  await card(other.id, (await note(other.id, theirA.id)).id);
  await card(other.id, (await note(other.id, theirA.id)).id);

  const counts = await flashcardRepository.deckCounts(mine.id, NOW);
  const byCourse = new Map(counts.map((c) => [c.courseId, c]));
  assert.equal(counts.length, 2);
  assert.deepEqual(byCourse.get(a.id), { courseId: a.id, total: 3, due: 2 });
  assert.deepEqual(byCourse.get(null), { courseId: null, total: 1, due: 1 });
  assert.equal(byCourse.has(theirA.id), false);
});

test("cards of a trashed note are neither listed nor counted, and come back when it is restored", async () => {
  const user = await newUser();
  const a = await course(user.id, "AAA1000");
  const kept = await note(user.id, a.id);
  const trashed = await note(user.id, a.id);
  await card(user.id, kept.id);
  await card(user.id, trashed.id);
  await card(user.id, trashed.id, TOMORROW);

  const snapshot = async () => ({
    due: await flashcardRepository.countDue(user.id, NOW),
    listed: (await flashcardRepository.listDue(user.id, NOW)).length,
    forCourse: await flashcardRepository.countDueForCourse(user.id, a.id, NOW),
    decks: await flashcardRepository.deckCounts(user.id, NOW),
  });

  const before = await snapshot();
  assert.deepEqual(before.decks, [{ courseId: a.id, total: 3, due: 2 }]);
  assert.equal(before.due, 2);

  await prisma.note.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
  const during = await snapshot();
  assert.equal(during.due, 1);
  assert.equal(during.listed, 1);
  assert.equal(during.forCourse, 1);
  assert.deepEqual(during.decks, [{ courseId: a.id, total: 1, due: 1 }]);

  await prisma.note.update({ where: { id: trashed.id }, data: { deletedAt: null } });
  assert.deepEqual(await snapshot(), before);
});

test("the due count equals the sum of the deck due counts", async () => {
  const user = await newUser();
  const a = await course(user.id, "AAA1000");
  const gone = await course(user.id, "OLD1000", true);
  await card(user.id, (await note(user.id, a.id)).id);
  await card(user.id, (await note(user.id, a.id)).id, TOMORROW);
  await card(user.id, (await note(user.id, gone.id)).id);
  await card(user.id, (await note(user.id)).id);
  await card(user.id, null);
  await card(user.id, (await note(user.id, a.id, true)).id); // trashed note
  await card(user.id, (await note(user.id, null, true)).id); // trashed note, no course

  const counts = await flashcardRepository.deckCounts(user.id, NOW);
  const sum = counts.reduce((total, c) => total + c.due, 0);
  assert.equal(sum, await flashcardRepository.countDue(user.id, NOW));
  assert.equal(sum, 4);
  // Five live cards: the trashed notes' two are in no deck at all.
  assert.equal(counts.reduce((total, c) => total + c.total, 0), 5);
});

test("listDecks labels decks from the caller's own courses, leaves out empty ones, and puts No course last", async () => {
  const user = await newUser();
  const other = await newUser();
  const busy = await course(user.id, "BBB1000");
  const quiet = await course(user.id, "AAA1000");
  await course(user.id, "EMPTY10"); // no cards: not a deck
  const theirs = await course(other.id, "ZZZ9999");

  await card(user.id, (await note(user.id, busy.id)).id);
  await card(user.id, (await note(user.id, busy.id)).id);
  await card(user.id, (await note(user.id, quiet.id)).id);
  await card(user.id, (await note(user.id)).id);
  await card(other.id, (await note(other.id, theirs.id)).id);

  assert.deepEqual(await listDecks(user.id, NOW), [
    { id: busy.id, label: "BBB1000", title: "Title of BBB1000", total: 2, due: 2 },
    { id: quiet.id, label: "AAA1000", title: "Title of AAA1000", total: 1, due: 1 },
    { id: null, label: "No course", title: null, total: 1, due: 1 },
  ]);
});
