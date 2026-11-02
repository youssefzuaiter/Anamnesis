/**
 * Quiz me against a real Postgres, DB-only like the rest of this tier. The two model calls are
 * passed in as fakes, so no test here reaches Ollama; how well the real model judges is measured
 * in the evals. What these tests check is everything around the model: which cards are asked,
 * that nothing outside the caller's own scope or notes ever reaches a generator or a judge, that
 * a rule decides what a rule can, that a model failure degrades instead of failing, and that
 * nothing here ever records a grade.
 *
 * Each test makes its own accounts so one test's rows cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import type { Excerpt, QuizScope } from "@/lib/quiz";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import * as noteRepository from "@/repositories/note-repository";
import { checkAnswer, startQuiz, type Generator, type Judge } from "@/services/quiz-service";

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `quiz-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const NOW = new Date();
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);

const course = (userId: string, code = "QZ101") =>
  prisma.course.create({ data: { userId, code, title: `Title ${code}`, term: "Fall 2026" } });

const paragraph = (tag: string) => Array.from({ length: 100 }, (_, i) => `${tag}${i}`).join(" "); // about 790 characters
const LONG = [paragraph("alpha"), paragraph("beta"), paragraph("gamma")].join("\n\n");
const THIN = "Too short to ask anything about.";

const note = (
  userId: string,
  fields: { courseId?: string | null; content?: string; title?: string; deleted?: boolean } = {},
) =>
  prisma.note.create({
    data: {
      userId,
      courseId: fields.courseId ?? null,
      title: fields.title ?? `Note ${randomUUID()}`,
      content: fields.content ?? THIN,
      deletedAt: fields.deleted ? new Date() : null,
    },
  });

const card = (
  userId: string,
  noteId: string | null,
  fields: { question?: string; answer?: string; clozeIndex?: number | null; dueAt?: Date } = {},
) =>
  prisma.flashcard.create({
    data: {
      userId,
      noteId,
      question: fields.question ?? `Question ${randomUUID()}?`,
      answer: fields.answer ?? "Answer",
      clozeIndex: fields.clozeIndex ?? null,
      dueAt: fields.dueAt ?? day(-1),
    },
  });

const never: Generator = async () => {
  throw new Error("the generator must not be called");
};
const neverJudge: Judge = async () => {
  throw new Error("the judge must not be called");
};

const options = { now: NOW, seed: 0 };

async function expectCode(promise: Promise<unknown>, code: AppError["code"], message?: string) {
  await assert.rejects(promise, (error) => {
    return error instanceof AppError && error.code === code && (message === undefined || error.message === message);
  });
}

test("a quiz over a course asks its live cards, due first, and never calls the generator when cards suffice", async () => {
  const user = await newUser();
  const other = await newUser();
  const a = await course(user.id, "QZA101");
  const b = await course(user.id, "QZB101");
  const n1 = await note(user.id, { courseId: a.id });
  const n2 = await note(user.id, { courseId: a.id });
  const trashed = await note(user.id, { courseId: a.id, deleted: true });
  const elsewhere = await note(user.id, { courseId: b.id });
  const theirs = await note(other.id);

  await card(user.id, n1.id, { question: "n1 due -5?", dueAt: day(-5) });
  await card(user.id, n1.id, { question: "n1 due -3?", dueAt: day(-3) });
  await card(user.id, n1.id, { question: "n1 later +2?", dueAt: day(2) });
  await card(user.id, n2.id, { question: "n2 due -4?", dueAt: day(-4) });
  await card(user.id, n2.id, { question: "n2 later +1?", dueAt: day(1) });
  await card(user.id, trashed.id, { question: "trashed one?" });
  await card(user.id, trashed.id, { question: "trashed two?" });
  await card(user.id, elsewhere.id, { question: "other course?" });
  await card(other.id, theirs.id, { question: "someone else's?" });

  const result = await startQuiz(user.id, { kind: "course", id: a.id }, { ...options, count: 5 }, never);

  assert.ok(result.label.includes("QZA101"));
  assert.equal(result.notice, null);
  assert.ok(result.questions.every((q) => q.kind === "card"));
  assert.deepEqual(
    result.questions.map((q) => q.question),
    ["n1 due -5?", "n2 due -4?", "n1 due -3?", "n2 later +1?", "n1 later +2?"],
  );
});

test("a note quiz asks only that note's cards and one card per fill-in-the-blank text", async () => {
  const user = await newUser();
  const mine = await note(user.id);
  const another = await note(user.id);
  const cloze = "{{c1::Paris}} is the capital of {{c2::France}}";
  await card(user.id, mine.id, { question: cloze, answer: "Paris", clozeIndex: 1, dueAt: day(-3) });
  await card(user.id, mine.id, { question: cloze, answer: "France", clozeIndex: 2, dueAt: day(-3) });
  await card(user.id, mine.id, { question: "What makes ATP?", answer: "Mitochondria", dueAt: day(-2) });
  await card(user.id, another.id, { question: "a different note's card?" });

  const result = await startQuiz(user.id, { kind: "note", id: mine.id }, { ...options, count: 5 }, never);

  assert.equal(result.questions.length, 2);
  const blanks = result.questions.filter((q) => q.question.includes("___"));
  assert.equal(blanks.length, 1, "one of the two cloze cards, not both");
  assert.ok(result.questions.some((q) => q.question === "What makes ATP?"));
  assert.equal(result.notice, "Not enough written material to make more questions.");
});

test("the count is clamped to between 1 and 10", async () => {
  const user = await newUser();
  const n = await note(user.id);
  for (let i = 0; i < 12; i++) await card(user.id, n.id, { dueAt: day(-12 + i) });
  const scope: QuizScope = { kind: "note", id: n.id };

  assert.equal((await startQuiz(user.id, scope, { ...options, count: 99 }, never)).questions.length, 10);
  assert.equal((await startQuiz(user.id, scope, { ...options, count: 0 }, never)).questions.length, 1);
  assert.equal((await startQuiz(user.id, scope, options, never)).questions.length, 5, "the default is five");
});

test("cards are topped up with generated questions that stand on their excerpt, from the caller's own notes", async () => {
  const user = await newUser();
  const source = await note(user.id, { title: "Greek letters", content: LONG });
  await card(user.id, source.id, { question: "card one?", dueAt: day(-2) });
  await card(user.id, source.id, { question: "card two?", dueAt: day(-1) });

  let seen: Excerpt[] = [];
  let asked = 0;
  const generator: Generator = async (excerpts, count) => {
    seen = excerpts;
    asked = count;
    return [
      { question: "Which words come first in the passage?", reference: "alpha1 alpha2 alpha3", excerptIndex: 0 },
      { question: "What is chromodynamics?", reference: "quantum chromodynamics gluons", excerptIndex: 1 },
      { question: "A question about nothing?", reference: "alpha1", excerptIndex: 99 },
    ];
  };

  const result = await startQuiz(user.id, { kind: "note", id: source.id }, { ...options, count: 4 }, generator);

  assert.equal(asked, 2, "only the two missing questions are asked for");
  assert.equal(seen.length, 3, "three usable passages in the note");
  assert.ok(seen.every((e) => e.noteId === source.id && e.noteTitle === "Greek letters"));
  assert.equal(result.questions.length, 3);
  const generated = result.questions.filter((q) => q.kind === "generated");
  assert.equal(generated.length, 1, "the ungrounded and the out-of-range question are dropped");
  const [only] = generated;
  assert.ok(only.kind === "generated");
  assert.equal(only.noteId, source.id);
  assert.equal(only.noteTitle, "Greek letters");
  assert.equal(only.excerpt, seen[0].text);
  assert.equal(only.reference, "alpha1 alpha2 alpha3");
  assert.match(only.id, /^[0-9a-f-]{36}$/);
  assert.equal(result.notice, "Only 3 of the 4 questions could be made.");
});

test("the generator is only ever shown the caller's own notes", async () => {
  const owner = await newUser();
  const intruder = await newUser();
  const SECRET = `secret-${randomUUID()}`;
  const mine = await course(owner.id, "QZO101");
  const own = await note(owner.id, { courseId: mine.id, content: LONG });
  // The intruder's note on the same topic, in their own course and, forged in the database, in the owner's.
  const theirCourse = await course(intruder.id, "QZI101");
  await note(intruder.id, { courseId: theirCourse.id, content: `${LONG}\n\n${SECRET} ${paragraph("sigma")}` });
  await note(intruder.id, { courseId: mine.id, content: `${LONG}\n\n${SECRET} ${paragraph("tau")}` });

  for (const scope of [
    { kind: "note", id: own.id },
    { kind: "course", id: mine.id },
  ] as QuizScope[]) {
    const recorded: Excerpt[] = [];
    const generator: Generator = async (excerpts) => {
      recorded.push(...excerpts);
      return [];
    };
    await startQuiz(owner.id, scope, { ...options, count: 3 }, generator);
    assert.ok(recorded.length > 0, `${scope.kind}: the owner's own text was offered`);
    assert.ok(recorded.every((e) => !e.text.includes(SECRET)), `${scope.kind}: no excerpt holds the intruder's text`);
    assert.ok(recorded.every((e) => e.noteId === own.id), `${scope.kind}: every excerpt is from the owner's note`);
  }
});

test("an unreachable model gives a cards-only quiz with a notice, and so does unusable output", async () => {
  const user = await newUser();
  const n = await note(user.id, { content: LONG });
  await card(user.id, n.id, { question: "the one card?" });
  const scope: QuizScope = { kind: "note", id: n.id };

  const unreachable = await startQuiz(user.id, scope, { ...options, count: 3 }, async () => {
    throw new AppError("AI_UNAVAILABLE", "Ollama is off.");
  });
  assert.deepEqual(unreachable.questions.map((q) => q.question), ["the one card?"]);
  assert.equal(unreachable.notice, "The model could not be reached, so this quiz uses only your existing cards.");

  for (const unusable of [
    async () => {
      throw new AppError("AI_OUTPUT_INVALID", "not JSON");
    },
    async () => "just a string",
    async () => [{ question: "x", reference: "y" }],
    async () => [{ question: "too short", reference: "alpha1", excerptIndex: 0 }],
  ] as Generator[]) {
    const result = await startQuiz(user.id, scope, { ...options, count: 3 }, unusable);
    assert.deepEqual(result.questions.map((q) => q.question), ["the one card?"]);
    assert.equal(result.notice, "The model did not return usable questions, so this quiz uses only your existing cards.");
  }

  await assert.rejects(
    startQuiz(user.id, scope, { ...options, count: 3 }, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
});

test("a note or course with too little text and no cards has nothing to ask, says so, and calls no model", async () => {
  const user = await newUser();
  const c = await course(user.id);
  const thin = await note(user.id, { courseId: c.id, content: "x".repeat(100) });

  const forNote = await startQuiz(user.id, { kind: "note", id: thin.id }, options, never);
  assert.deepEqual(forNote.questions, []);
  assert.equal(forNote.notice, "Nothing to quiz yet: make some cards or write more in this note.");

  const forCourse = await startQuiz(user.id, { kind: "course", id: c.id }, options, never);
  assert.deepEqual(forCourse.questions, []);
  assert.equal(forCourse.notice, "Nothing to quiz yet: make some cards or write more in this course.");
});

test("a scope that is not yours is refused as one thing, and nothing is asked", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  const theirNote = await note(theirs.id, { content: LONG });
  const theirCourse = await course(theirs.id);
  const trashed = await note(mine.id, { deleted: true });
  const project = await prisma.project.create({ data: { userId: mine.id, title: "P", category: "University" } });

  const noteGone = "That note no longer exists.";
  const courseGone = "That course no longer exists.";
  for (const id of [theirNote.id, trashed.id, randomUUID()]) {
    await expectCode(startQuiz(mine.id, { kind: "note", id }, options, never), "RESOURCE_NOT_FOUND", noteGone);
  }
  for (const id of [theirCourse.id, project.id, randomUUID()]) {
    await expectCode(startQuiz(mine.id, { kind: "course", id }, options, never), "RESOURCE_NOT_FOUND", courseGone);
  }
});

test("checking by card id reads the reference on the server and refuses a card that is not yours", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  const n = await note(mine.id);
  const trashedNote = await note(mine.id, { deleted: true });
  const own = await card(mine.id, n.id, { question: "What makes ATP?", answer: "Mitochondria" });
  const cloze = await card(mine.id, n.id, {
    question: "{{c1::Paris}} is the capital of {{c2::France}}",
    answer: "Paris",
    clozeIndex: 1,
  });
  const foreign = await card(theirs.id, (await note(theirs.id)).id);
  const inTrash = await card(mine.id, trashedNote.id);

  const calls: Parameters<Judge>[0][] = [];
  const judge: Judge = async (input) => {
    calls.push(input);
    return { verdict: "incorrect", feedback: "That is not it." };
  };

  const result = await checkAnswer(mine.id, { kind: "card", cardId: own.id, answer: "the nucleus" }, judge);
  assert.equal(result.reference, "Mitochondria");
  assert.equal(calls[0].reference, "Mitochondria");
  assert.equal(calls[0].question, "What makes ATP?");
  assert.equal(calls[0].excerpt, null);

  const clozeResult = await checkAnswer(mine.id, { kind: "card", cardId: cloze.id, answer: "Lyon" }, judge);
  assert.equal(clozeResult.reference, "Paris");
  assert.equal(calls[1].question, "___ is the capital of France");

  const calledBefore = calls.length;
  for (const cardId of [foreign.id, inTrash.id, randomUUID()]) {
    await expectCode(
      checkAnswer(mine.id, { kind: "card", cardId, answer: "anything" }, judge),
      "RESOURCE_NOT_FOUND",
      "That card no longer exists.",
    );
  }
  assert.equal(calls.length, calledBefore, "a card that is not yours never reaches the judge");
});

test("rules decide the trivial answers without the judge", async () => {
  const user = await newUser();
  const own = await card(user.id, (await note(user.id)).id, { question: "What makes ATP?", answer: "Mitochondria" });

  const exact = await checkAnswer(user.id, { kind: "card", cardId: own.id, answer: "  the mitochondria. " }, neverJudge);
  assert.deepEqual(exact, {
    reference: "Mitochondria",
    decidedBy: "rule",
    verdict: "correct",
    feedback: "That matches the answer.",
    suggestedGrade: "good",
    problem: null,
  });

  for (const answer of ["", "   ", "I don't know", "idk"]) {
    const result = await checkAnswer(user.id, { kind: "card", cardId: own.id, answer }, neverJudge);
    assert.equal(result.decidedBy, "rule", JSON.stringify(answer));
    assert.equal(result.verdict, "incorrect");
    assert.equal(result.suggestedGrade, "again");
    assert.equal(result.reference, "Mitochondria");
  }
});

test("the judge decides the rest, and its verdict is only a suggestion", async () => {
  const user = await newUser();
  const own = await card(user.id, (await note(user.id)).id, { question: "What makes ATP?", answer: "Mitochondria" });
  const judge: Judge = async () => ({ verdict: "partly", feedback: "Close: you left out the organelle's name." });

  const result = await checkAnswer(user.id, { kind: "card", cardId: own.id, answer: "something in the cell" }, judge);

  assert.equal(result.decidedBy, "model");
  assert.equal(result.verdict, "partly");
  assert.equal(result.suggestedGrade, "hard");
  assert.equal(result.feedback, "Close: you left out the organelle's name.");
  assert.equal(result.problem, null);
});

test("a generated question is judged from what it carries, with its excerpt", async () => {
  const user = await newUser();
  const received: Parameters<Judge>[0][] = [];
  const judge: Judge = async (input) => {
    received.push(input);
    return { verdict: "correct", feedback: "Yes." };
  };

  const result = await checkAnswer(
    user.id,
    {
      kind: "generated",
      question: "What do mitochondria make?",
      reference: "ATP",
      excerpt: "Mitochondria make ATP in the cell.",
      answer: "adenosine triphosphate",
    },
    judge,
  );

  assert.deepEqual(received[0], {
    question: "What do mitochondria make?",
    reference: "ATP",
    excerpt: "Mitochondria make ATP in the cell.",
    answer: "adenosine triphosphate",
  });
  assert.equal(result.verdict, "correct");
  assert.equal(result.reference, "ATP");

  // No excerpt travelled with it: the judge is told there is none.
  await checkAnswer(
    user.id,
    { kind: "generated", question: "Q?", reference: "R", excerpt: "", answer: "something else" },
    judge,
  );
  assert.equal(received[1].excerpt, null);
});

test("a judge that is unreachable or returns rubbish gives no verdict instead of an error", async () => {
  const user = await newUser();
  const own = await card(user.id, (await note(user.id)).id, { answer: "Mitochondria" });
  const input = { kind: "card", cardId: own.id, answer: "a long wrong guess" } as const;

  const unreachable = await checkAnswer(user.id, input, async () => {
    throw new AppError("AI_UNAVAILABLE", "Ollama is off.");
  });
  assert.deepEqual(unreachable, {
    reference: "Mitochondria",
    decidedBy: "none",
    verdict: null,
    feedback: null,
    suggestedGrade: null,
    problem: "unavailable",
  });

  for (const rubbish of [
    { verdict: "excellent", feedback: "great" },
    { verdict: "correct", feedback: "" },
    { verdict: "correct", feedback: "x".repeat(401) },
    { verdict: "correct" },
    "correct",
    null,
  ]) {
    const result = await checkAnswer(user.id, input, async () => rubbish);
    assert.equal(result.decidedBy, "none", JSON.stringify(rubbish));
    assert.equal(result.problem, "invalid");
    assert.equal(result.verdict, null);
    assert.equal(result.reference, "Mitochondria");
  }

  await assert.rejects(
    checkAnswer(user.id, input, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
});

test("starting and checking a quiz never changes a card", async () => {
  const user = await newUser();
  const n = await note(user.id, { content: LONG });
  await card(user.id, n.id, { question: "one?", answer: "uno", dueAt: day(-1) });
  await card(user.id, n.id, { question: "two?", answer: "dos", dueAt: day(-2) });
  const snapshot = async () =>
    (await prisma.flashcard.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).map(
      (c) => `${c.id}|${c.dueAt.toISOString()}|${c.repetitions}|${c.intervalDays}|${c.easeFactor}|${c.lastReviewed}`,
    );
  const before = await snapshot();

  const result = await startQuiz(user.id, { kind: "note", id: n.id }, { ...options, count: 2 }, never);
  for (const question of result.questions) {
    assert.equal(question.kind, "card");
    if (question.kind !== "card") continue;
    await checkAnswer(user.id, { kind: "card", cardId: question.id, answer: "uno" }, async () => ({
      verdict: "correct",
      feedback: "Yes.",
    }));
    await checkAnswer(user.id, { kind: "card", cardId: question.id, answer: "" }, neverJudge);
  }
  await checkAnswer(
    user.id,
    { kind: "generated", question: "Q?", reference: "R", excerpt: "E", answer: "R" },
    neverJudge,
  );

  assert.deepEqual(await snapshot(), before);
  assert.equal(await prisma.flashcard.count({ where: { userId: user.id } }), 2);
});

// The service only ever hands these reads ids it has already resolved to the caller's own live
// notes, so a quiz test cannot see them fail: a read that lost its `userId` or its trash filter
// would still return the right rows. They are checked here on their own, with ids they must refuse.
test("the reads behind a quiz hold the caller and the trash themselves, whatever ids they are given", async () => {
  const user = await newUser();
  const other = await newUser();
  const mine = await note(user.id, { content: LONG });
  const trashed = await note(user.id, { content: LONG, deleted: true });
  const theirs = await note(other.id, { content: LONG });
  const kept = await card(user.id, mine.id, { question: "mine?" });
  await card(user.id, trashed.id, { question: "in the trash?" });
  await card(other.id, theirs.id, { question: "someone else's?" });

  const ids = [mine.id, trashed.id, theirs.id];
  const cards = await flashcardRepository.listForNotes(user.id, ids, 50);
  assert.deepEqual(cards.map((c) => c.id), [kept.id]);
  const texts = await noteRepository.listNoteTexts(user.id, ids, 50);
  assert.deepEqual(texts.map((n) => n.id), [mine.id]);

  assert.deepEqual(await flashcardRepository.listForNotes(user.id, [], 50), []);
  assert.deepEqual(await noteRepository.listNoteTexts(user.id, [], 50), []);
});

// Found in the review of this branch: nothing stopped a model that repeats itself from filling a
// quiz with one question, and the seed was the day of the year, so "Quiz again" asked the same
// passages (and, at temperature 0, the same questions) all day.
test("a generated question the model repeats is asked once", async () => {
  const user = await newUser();
  const source = await note(user.id, { content: LONG });
  const generator: Generator = async () => [
    { question: "Which words come first in the passage?", reference: "alpha1 alpha2 alpha3", excerptIndex: 0 },
    { question: "which words come FIRST in the passage", reference: "alpha1 alpha2", excerptIndex: 0 },
    { question: "Which words come first in the passage?", reference: "alpha4 alpha5", excerptIndex: 0 },
    { question: "What does the second passage list?", reference: "beta1 beta2 beta3", excerptIndex: 1 },
  ];

  const result = await startQuiz(user.id, { kind: "note", id: source.id }, { ...options, count: 4 }, generator);

  assert.deepEqual(
    result.questions.map((q) => q.question),
    ["Which words come first in the passage?", "What does the second passage list?"],
  );
  assert.equal(result.notice, "Only 2 of the 4 questions could be made.");
});

test("a quiz started later is not offered the passages in the same order, and the same moment is", async () => {
  const user = await newUser();
  const source = await note(user.id, { content: LONG });
  const first: string[] = [];
  const generator: Generator = async (excerpts) => {
    first.push(excerpts[0].text);
    return [];
  };
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
  const scope: QuizScope = { kind: "note", id: source.id };

  await startQuiz(user.id, scope, { now: at(0), count: 3 }, generator);
  await startQuiz(user.id, scope, { now: at(1), count: 3 }, generator);
  await startQuiz(user.id, scope, { now: at(0), count: 3 }, generator);

  assert.notEqual(first[0], first[1], "a second start does not begin with the same passage");
  assert.equal(first[0], first[2], "the same moment gives the same passages");
});
