import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  GROUNDED_MIN,
  MAX_EXCERPT_CHARS,
  MIN_EXCERPT_CHARS,
  cardQuestion,
  cardReference,
  checkAnswerInputSchema,
  contentWords,
  gradeToVerdict,
  groundedness,
  isGrounded,
  normaliseAnswer,
  parseQuizScope,
  pickQuestionCards,
  quizHref,
  ruleVerdict,
  sampleExcerpts,
  scoreSession,
  verdictToGrade,
} from "@/lib/quiz";

test("normaliseAnswer lowercases, drops punctuation and articles, and collapses spaces", () => {
  assert.equal(normaliseAnswer("  The Heart!  "), "heart");
  assert.equal(normaliseAnswer("heart"), "heart");
  assert.equal(normaliseAnswer("Çok   güzel."), "çok güzel");
  assert.equal(normaliseAnswer("?!"), "");
  assert.equal(normaliseAnswer("   "), "");
});

test("normaliseAnswer removes apostrophes instead of splitting words at them", () => {
  assert.equal(normaliseAnswer("I don't know"), "i dont know");
  assert.equal(normaliseAnswer("it’s"), "its");
});

test("articles are dropped only when something else remains", () => {
  assert.equal(normaliseAnswer("A"), "a");
  assert.equal(normaliseAnswer("the"), "the");
  assert.equal(normaliseAnswer("a the an"), "a the an");
});

test("ruleVerdict marks empty and don't-know answers incorrect", () => {
  for (const answer of ["", "   ", "?", "idk", "I don't know", "I do not know", "no idea", "Not sure.", "Bilmiyorum."]) {
    assert.equal(ruleVerdict(answer, "the heart"), "incorrect", JSON.stringify(answer));
  }
});

test("ruleVerdict marks an answer equal to the reference correct", () => {
  assert.equal(ruleVerdict("The heart", "heart"), "correct");
  assert.equal(ruleVerdict("ATP.", "atp"), "correct");
  assert.equal(ruleVerdict("A", "a"), "correct");
});

test("ruleVerdict leaves everything else to the model", () => {
  assert.equal(ruleVerdict("not the heart", "the heart"), null);
  assert.equal(ruleVerdict("heart muscle", "heart"), null);
  assert.equal(ruleVerdict("blood", "heart"), null);
  assert.equal(ruleVerdict("a", "b"), null);
  assert.equal(ruleVerdict("anything", ""), null);
});

test("verdictToGrade never suggests easy, and gradeToVerdict reads a grade back", () => {
  assert.equal(verdictToGrade("correct"), "good");
  assert.equal(verdictToGrade("partly"), "hard");
  assert.equal(verdictToGrade("incorrect"), "again");
  assert.equal(gradeToVerdict("again"), "incorrect");
  assert.equal(gradeToVerdict("hard"), "partly");
  assert.equal(gradeToVerdict("good"), "correct");
  assert.equal(gradeToVerdict("easy"), "correct");
});

test("scoreSession counts correct as 1 and partly as 0.5", () => {
  assert.deepEqual(scoreSession(["correct", "partly", "incorrect", "correct"]), {
    score: 2.5,
    total: 4,
    correct: 2,
    partly: 1,
    incorrect: 1,
  });
  assert.deepEqual(scoreSession([]), { score: 0, total: 0, correct: 0, partly: 0, incorrect: 0 });
});

test("cardQuestion shows a cloze blank as ___, with its hint when it has one", () => {
  const cloze = "{{c1::Paris}} is the capital of {{c2::France}}";
  assert.equal(cardQuestion({ question: cloze, clozeIndex: 1 }), "___ is the capital of France");
  assert.equal(cardQuestion({ question: cloze, clozeIndex: 2 }), "Paris is the capital of ___");
  assert.equal(
    cardQuestion({ question: "{{c1::Paris::city}} is the capital of France", clozeIndex: 1 }),
    "___ (city) is the capital of France",
  );
  assert.equal(cardQuestion({ question: "What makes ATP?", clozeIndex: null }), "What makes ATP?");
});

test("cardReference is the group's answers for a cloze card and the stored answer for a basic one", () => {
  const cloze = "{{c1::Paris}} is the capital of {{c2::France}}";
  assert.equal(cardReference({ question: cloze, answer: "Paris", clozeIndex: 1 }), "Paris");
  assert.equal(cardReference({ question: cloze, answer: "France", clozeIndex: 2 }), "France");
  assert.equal(cardReference({ question: "What makes ATP?", answer: "Mitochondria", clozeIndex: null }), "Mitochondria");
});

test("pickQuestionCards asks due cards first, oldest first, then the rest, one per cloze text", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);
  const card = (id: string, noteId: string, question: string, clozeIndex: number | null, dueAt: Date) => ({
    id,
    noteId,
    question,
    clozeIndex,
    dueAt,
  });
  const cards = [
    card("e", "n2", "Not due yet?", null, day(1)),
    card("c", "n1", "T {{c1::x}} {{c2::y}}", 2, day(-2)),
    card("a", "n1", "Oldest due?", null, day(-3)),
    card("b", "n1", "T {{c1::x}} {{c2::y}}", 1, day(-2)),
    card("d", "n2", "Due yesterday?", null, day(-1)),
  ];

  assert.deepEqual(pickQuestionCards(cards, 10, now).map((c) => c.id), ["a", "c", "d", "e"]);
  assert.deepEqual(pickQuestionCards(cards, 2, now).map((c) => c.id), ["a", "c"]);
  assert.deepEqual(pickQuestionCards(cards, 0, now), []);
  assert.deepEqual(pickQuestionCards([], 5, now), []);
});

const paragraph = (tag: string) =>
  Array.from({ length: 100 }, (_, i) => `${tag}${i}`).join(" "); // about 650 characters

test("sampleExcerpts is deterministic, drops thin text and covers every note that has any", () => {
  const notes = [
    { id: "thin", title: "Thin", content: "Far too short to ask anything about." },
    { id: "n1", title: "One", content: [paragraph("alpha"), paragraph("beta"), paragraph("gamma")].join("\n\n") },
    { id: "n2", title: "Two", content: [paragraph("delta"), paragraph("omega")].join("\n\n") },
  ];

  const first = sampleExcerpts(notes, 2, 0);
  assert.deepEqual(sampleExcerpts(notes, 2, 0), first, "the same seed gives the same excerpts");
  assert.deepEqual(first.map((e) => e.noteId).sort(), ["n1", "n2"], "one from each note that has text");
  assert.notDeepEqual(sampleExcerpts(notes, 2, 1), first, "another seed picks other chunks");

  const all = sampleExcerpts(notes, 10, 0);
  assert.equal(all.length, 5);
  assert.ok(all.every((e) => e.noteId !== "thin"));
  assert.ok(all.every((e) => e.text.length >= MIN_EXCERPT_CHARS && e.text.length <= MAX_EXCERPT_CHARS));
  assert.deepEqual(all.find((e) => e.noteId === "n1")?.noteTitle, "One");
  assert.deepEqual(sampleExcerpts(notes, 0, 0), []);
  assert.deepEqual(sampleExcerpts([], 3, 0), []);
});

test("groundedness is the share of the answer's content words found in the excerpt", () => {
  const excerpt = "Mitochondria make ATP in the cell.";
  assert.equal(groundedness("mitochondria make ATP", excerpt), 1);
  assert.equal(groundedness("quantum entanglement", excerpt), 0);
  assert.ok(Math.abs(groundedness("mitochondria make energy", excerpt) - 2 / 3) < 1e-9);
  assert.equal(groundedness("", excerpt), 0);
});

test("an answer with no content word is grounded only if it occurs whole in the excerpt", () => {
  assert.equal(groundedness("42", "The answer is 42."), 1);
  assert.equal(groundedness("42", "The answer is 142."), 0);
  assert.equal(groundedness("42", "The answer is 7."), 0);
});

test("isGrounded uses GROUNDED_MIN unless told otherwise", () => {
  const excerpt = "Mitochondria make ATP in the cell.";
  assert.equal(GROUNDED_MIN, 0.6);
  assert.equal(isGrounded("mitochondria make energy", excerpt), true); // 2/3
  assert.equal(isGrounded("mitochondria energy fuel", excerpt), false); // 1/3
  assert.equal(isGrounded("mitochondria make energy", excerpt, 0.9), false);
  assert.equal(isGrounded("anything at all", excerpt, 0), true);
});

test("contentWords drops short words and stop words", () => {
  assert.deepEqual(contentWords("The cell is in the body of an organism."), ["cell", "body", "organism"]);
});

const uuid = randomUUID();

test("checkAnswerInputSchema bounds every field", () => {
  const card = { kind: "card", cardId: uuid, answer: "x" } as const;
  const generated = { kind: "generated", question: "Q?", reference: "R", excerpt: "E", answer: "x" } as const;
  assert.equal(checkAnswerInputSchema.safeParse(card).success, true);
  assert.equal(checkAnswerInputSchema.safeParse(generated).success, true);
  assert.equal(checkAnswerInputSchema.safeParse({ ...card, answer: "" }).success, true, "an empty answer is allowed");

  const refused: unknown[] = [
    { ...card, answer: "x".repeat(2001) },
    { ...card, cardId: "not-a-uuid" },
    { ...card, userId: uuid },
    { ...generated, question: "q".repeat(1001) },
    { ...generated, question: "" },
    { ...generated, reference: "r".repeat(2001) },
    { ...generated, excerpt: "e".repeat(1501) },
    { ...generated, answer: "a".repeat(2001) },
    { kind: "other", answer: "x" },
    null,
  ];
  for (const input of refused) {
    assert.equal(checkAnswerInputSchema.safeParse(input).success, false, JSON.stringify(input)?.slice(0, 60));
  }
});

test("parseQuizScope accepts note and course only", () => {
  assert.deepEqual(parseQuizScope(`note:${uuid}`), { kind: "note", id: uuid });
  assert.deepEqual(parseQuizScope(`course:${uuid}`), { kind: "course", id: uuid });
  for (const bad of [`project:${uuid}`, `NOTE:${uuid}`, `note:${uuid}x`, "note:abc", "", undefined, [`note:${uuid}`]]) {
    assert.equal(parseQuizScope(bad as string | undefined), null, String(bad));
  }
  assert.equal(quizHref({ kind: "course", id: uuid }), `/quiz?scope=course:${uuid}`);
  assert.deepEqual(parseQuizScope(quizHref({ kind: "note", id: uuid }).split("scope=")[1]), { kind: "note", id: uuid });
});

test("hostile input of 100,000 characters stays fast", () => {
  const hostile = [
    " ".repeat(100_000),
    "a ".repeat(50_000),
    "x".repeat(100_000),
    "!?.,;:".repeat(16_667),
    "word ".repeat(20_000),
  ];
  for (const text of hostile) {
    const start = performance.now();
    normaliseAnswer(text);
    ruleVerdict(text, text);
    contentWords(text);
    groundedness(text, text);
    groundedness(text, hostile[1]);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `${elapsed.toFixed(0)} ms for ${JSON.stringify(text.slice(0, 12))}`);
  }

  const start = performance.now();
  sampleExcerpts([{ id: "n", title: "Tiny lines", content: "a\n".repeat(50_000) }], 8, 3);
  sampleExcerpts([{ id: "n", title: "One long line", content: "word ".repeat(20_000) }], 8, 3);
  assert.ok(performance.now() - start < 1000);

  // A normaliser that rescanned for each separator would be quadratic; 1.6 million characters shows it.
  const big = "a. ".repeat(533_333);
  const t = performance.now();
  normaliseAnswer(big);
  const elapsed = performance.now() - t;
  assert.ok(elapsed < 1000, `${elapsed.toFixed(0)} ms for 1.6 million characters`);
});

// Found in the review of this branch by running the rule judge on awkward answers: both put a wrong
// verdict on the one path that has no model behind it.
test("an answer that is itself a don't-know phrase is correct when the reference says so", () => {
  assert.equal(ruleVerdict("pass", "pass"), "correct");
  assert.equal(ruleVerdict("Unknown.", "unknown"), "correct");
  assert.equal(ruleVerdict("Skip", "skip"), "correct");
  // The phrase is still a non-answer to any other question, and an empty reference never matches.
  assert.equal(ruleVerdict("pass", "continue"), "incorrect");
  assert.equal(ruleVerdict("", ""), "incorrect");
});

test("symbols that change what an answer says are not thrown away with the punctuation", () => {
  const different: [string, string][] = [
    ["1", "-1"],
    ["x > 5", "x < 5"],
    ["a + b", "a - b"],
    ["a + b", "b"],
    ["C", "C++"],
    ["C", "C#"],
    ["50", "50%"],
    ["a × b", "a ÷ b"],
    ["$5", "5"],
    ["x = 2", "x 2"],
  ];
  for (const [answer, reference] of different) {
    assert.notEqual(ruleVerdict(answer, reference), "correct", `${answer} is not ${reference}`);
    assert.notEqual(ruleVerdict(reference, answer), "correct", `${reference} is not ${answer}`);
  }
});

test("ordinary punctuation, hyphens, ranges and the same symbol written two ways still match", () => {
  const same: [string, string][] = [
    ["well-known!", "well known"],
    ["5-10", "5 – 10"],
    ["-1", "−1"], // hyphen-minus and the true minus sign
    ["C++", "c ++"],
    ["x < 5", "X<5"],
    ["50 %", "50%"],
    ["（１＋２）", "(1+2)"], // full-width forms fold under NFKC
    ["The mitochondria.", "mitochondria"],
  ];
  for (const [answer, reference] of same) {
    assert.equal(ruleVerdict(answer, reference), "correct", `${answer} is ${reference}`);
  }
  assert.equal(normaliseAnswer("-1"), normaliseAnswer("−1"));
});

test("the symbol handling stays linear on hostile input", () => {
  const shapes = ["+".repeat(100_000), "-".repeat(100_000), "-1".repeat(50_000), "−".repeat(100_000), "`".repeat(100_000), "$%#*/<>=".repeat(12_500)];
  const start = performance.now();
  for (const text of shapes) {
    normaliseAnswer(text);
    ruleVerdict(text, text);
    groundedness(text, text);
  }
  assert.ok(performance.now() - start < 2000, `took ${Math.round(performance.now() - start)} ms`);
});
