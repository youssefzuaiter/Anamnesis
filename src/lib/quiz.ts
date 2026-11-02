// Quiz me: the rules that need no model. Which cards to ask, how an answer is read, which answers
// are decided without a model, how a verdict maps to a card grade, how a session is scored, which
// excerpts a model may write questions from, and whether a generated question stands on its
// excerpt. Pure text logic: no React, no Prisma, no network. The two model calls live in
// `services/quiz-service.ts`; everything here is checkable on its own.

import { z } from "zod";
import { parseScopeParam } from "@/lib/assistant-scope";
import { chunkText } from "@/lib/chunking";
import { answerFor, renderCloze, spreadSiblings } from "@/lib/cloze";
import type { ReviewGrade } from "@/lib/spaced-repetition";

export const QUIZ_DEFAULT_COUNT = 5;
export const QUIZ_MAX_COUNT = 10;

// Bounds on what a browser may send, checked before any model sees it.
export const MAX_ANSWER_CHARS = 2000;
export const MAX_QUESTION_CHARS = 1000;
export const MAX_REFERENCE_CHARS = 2000;
export const MAX_EXCERPT_CHARS = 1500;
/** A passage shorter than this is a heading or a stray line, not something to ask about. */
export const MIN_EXCERPT_CHARS = 200;

/**
 * How much of a generated answer must be made of words from the passage it cites. A starting
 * value: the evals print the distribution and the final number is chosen from it.
 */
export const GROUNDED_MIN = 0.6;

/** A normalised answer longer than this is never matched as a whole phrase inside a passage. */
const SHORT_ANSWER_CHARS = 200;

export const VERDICTS = ["correct", "partly", "incorrect"] as const;
export type Verdict = (typeof VERDICTS)[number];

// --- Scope -------------------------------------------------------------------------------------

export type QuizScope = { kind: "note" | "course"; id: string };

/** Strict: a stray key (a `userId`, say) is a rejected request, not an ignored one. */
export const quizScopeSchema = z
  .object({ kind: z.enum(["note", "course"]), id: z.uuid() })
  .strict();

/** `?scope=note:<uuid>` or `?scope=course:<uuid>`; a project scope or anything malformed is null. */
export function parseQuizScope(value: string | string[] | undefined): QuizScope | null {
  const scope = parseScopeParam(value);
  if (!scope || (scope.kind !== "note" && scope.kind !== "course")) return null;
  return { kind: scope.kind, id: scope.id };
}

export function quizHref(scope: QuizScope): string {
  return `/quiz?scope=${scope.kind}:${scope.id}`;
}

// --- What travels between the browser and the server --------------------------------------------

/**
 * A card question carries only its id: the server reads the reference itself, so it never comes
 * from the browser. A generated question has no row to look up, so it carries its own text,
 * which is bounded and treated as untrusted.
 */
export type QuizQuestion =
  | { kind: "card"; id: string; noteId: string | null; question: string }
  | {
      kind: "generated";
      id: string;
      noteId: string;
      noteTitle: string;
      question: string;
      reference: string;
      excerpt: string;
    };

export const checkAnswerInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("card"),
      cardId: z.uuid(),
      answer: z.string().max(MAX_ANSWER_CHARS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("generated"),
      question: z.string().min(1).max(MAX_QUESTION_CHARS),
      reference: z.string().min(1).max(MAX_REFERENCE_CHARS),
      excerpt: z.string().max(MAX_EXCERPT_CHARS),
      answer: z.string().max(MAX_ANSWER_CHARS),
    })
    .strict(),
]);
export type CheckAnswerInput = z.infer<typeof checkAnswerInputSchema>;

export type CheckResult = {
  /** What a good answer was, shown after checking. Always present, even if the model could not judge. */
  reference: string;
  decidedBy: "rule" | "model" | "none";
  verdict: Verdict | null;
  feedback: string | null;
  /** The card grade this verdict suggests; the person chooses. Null when there is no verdict. */
  suggestedGrade: ReviewGrade | null;
  /** Why there is no verdict, when decidedBy is "none". */
  problem: "unavailable" | "invalid" | null;
};

// --- Reading an answer -------------------------------------------------------------------------

const ARTICLES = new Set(["a", "an", "the"]);

/** Lower-case words with apostrophes removed (don't becomes dont) and every other mark a space. */
function tokens(text: string): string[] {
  const folded = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return folded === "" ? [] : folded.split(" ");
}

/**
 * An answer reduced to what it says: case, punctuation, spacing and the articles a, an and the
 * are ignored, unless that would leave nothing (a multiple-choice "A"). Linear in the text.
 */
export function normaliseAnswer(text: string): string {
  const all = tokens(text);
  const kept = all.filter((token) => !ARTICLES.has(token));
  return (kept.length > 0 ? kept : all).join(" ");
}

// A judgement, listed in CLAUDE.md: the phrases a person types to say they have no answer.
const DONT_KNOW = new Set([
  "",
  "idk",
  "dunno",
  "i dont know",
  "i do not know",
  "dont know",
  "no idea",
  "no clue",
  "not sure",
  "pass",
  "skip",
  "unknown",
  "bilmiyorum",
  "fikrim yok",
]);

export function isDontKnow(normalised: string): boolean {
  return DONT_KNOW.has(normalised);
}

/**
 * The verdict a rule can give without a model: no answer, or "I don't know", is incorrect; an
 * answer equal to the reference once normalised is correct. Anything else, a negation or an extra
 * word included, is for the model.
 */
export function ruleVerdict(answer: string, reference: string): Verdict | null {
  const given = normaliseAnswer(answer);
  if (isDontKnow(given)) return "incorrect";
  const expected = normaliseAnswer(reference);
  return expected !== "" && given === expected ? "correct" : null;
}

// --- Grades and scores -------------------------------------------------------------------------

const VERDICT_GRADE: Record<Verdict, ReviewGrade> = { correct: "good", partly: "hard", incorrect: "again" };
const GRADE_VERDICT: Record<ReviewGrade, Verdict> = { again: "incorrect", hard: "partly", good: "correct", easy: "correct" };

/** What a verdict suggests for a card. Never "easy": that is for the person to say. */
export function verdictToGrade(verdict: Verdict): ReviewGrade {
  return VERDICT_GRADE[verdict];
}

/** What a grade the person chose says about how the question went. */
export function gradeToVerdict(grade: ReviewGrade): Verdict {
  return GRADE_VERDICT[grade];
}

export function scoreSession(verdicts: Verdict[]) {
  const correct = verdicts.filter((verdict) => verdict === "correct").length;
  const partly = verdicts.filter((verdict) => verdict === "partly").length;
  return {
    score: correct + partly / 2,
    total: verdicts.length,
    correct,
    partly,
    incorrect: verdicts.length - correct - partly,
  };
}

// --- Cards as questions ------------------------------------------------------------------------

/** The question a card asks: its front, with a fill-in-the-blank's blank shown as ___ (and its hint). */
export function cardQuestion(card: { question: string; clozeIndex: number | null }): string {
  if (card.clozeIndex === null) return card.question;
  return renderCloze(card.question, card.clozeIndex)
    .front.map((piece) => {
      if (piece.role !== "blank") return piece.text;
      return piece.text === "…" ? "___" : `___ (${piece.text})`;
    })
    .join("");
}

/** What the card says the answer is. */
export function cardReference(card: {
  question: string;
  answer: string;
  clozeIndex: number | null;
}): string {
  return card.clozeIndex === null ? card.answer : answerFor(card.question, card.clozeIndex);
}

/**
 * Which cards to ask: the due ones first, oldest due first, then the rest; one card per
 * fill-in-the-blank text, because the front of a second shows the answer to the first.
 */
export function pickQuestionCards<
  T extends { id: string; noteId: string | null; question: string; clozeIndex: number | null; dueAt: Date },
>(cards: T[], count: number, now: Date): T[] {
  const byDue = (a: T, b: T) => a.dueAt.getTime() - b.dueAt.getTime();
  const due = cards.filter((card) => card.dueAt <= now).sort(byDue);
  const later = cards.filter((card) => card.dueAt > now).sort(byDue);
  return spreadSiblings([...due, ...later]).session.slice(0, Math.max(0, count));
}

// --- Passages to ask about ----------------------------------------------------------------------

export type Excerpt = { noteId: string; noteTitle: string; text: string };

/**
 * The passages a model may write questions from. Each note's text is cut into chunks, thin ones
 * are dropped, and passages are taken round-robin across the notes, so every note that has any
 * usable text is represented before any note is represented twice. `seed` rotates which note and
 * which chunk come first, so a second quiz need not repeat the first, and the same seed always
 * gives the same passages.
 */
export function sampleExcerpts(
  notes: { id: string; title: string; content: string }[],
  count: number,
  seed: number,
): Excerpt[] {
  if (count <= 0) return [];

  const pools = notes.flatMap((note) => {
    const texts = chunkText(note.content)
      .filter((text) => text.length >= MIN_EXCERPT_CHARS)
      .map((text) => text.slice(0, MAX_EXCERPT_CHARS));
    return texts.length > 0 ? [{ noteId: note.id, noteTitle: note.title, texts }] : [];
  });
  if (pools.length === 0) return [];

  const shift = Math.abs(Math.trunc(seed));
  const start = shift % pools.length;
  const ordered = [...pools.slice(start), ...pools.slice(0, start)];
  const rounds = pools.reduce((most, pool) => Math.max(most, pool.texts.length), 0);

  const excerpts: Excerpt[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const pool of ordered) {
      if (round >= pool.texts.length) continue;
      const text = pool.texts[(shift + round) % pool.texts.length];
      excerpts.push({ noteId: pool.noteId, noteTitle: pool.noteTitle, text });
      if (excerpts.length === count) return excerpts;
    }
  }
  return excerpts;
}

// --- Is a generated question grounded? ---------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from", "have", "has", "had",
  "not", "but", "you", "your", "its", "they", "their", "there", "which", "what", "when", "where",
  "who", "how", "into", "than", "then", "also", "can", "will", "would", "should", "could", "been",
  "being", "about", "over", "such", "these", "those", "each", "other", "some", "any", "all", "may",
  "more", "most", "very", "just", "only", "does", "did", "our", "out", "use", "used", "using",
]);

/** The words of a text that carry meaning: three letters or more, not a stop word, each once. */
export function contentWords(text: string): string[] {
  return [...new Set(tokens(text).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))];
}

/**
 * The share of the answer's content words that the passage contains. An answer with none (a
 * number, a single letter) is grounded only if it occurs whole in the passage; a long one with
 * none scores 0, so no search is ever run with a long pattern.
 */
export function groundedness(answer: string, excerpt: string): number {
  const words = contentWords(answer);
  if (words.length === 0) {
    const whole = normaliseAnswer(answer);
    if (whole === "" || whole.length > SHORT_ANSWER_CHARS) return 0;
    return ` ${normaliseAnswer(excerpt)} `.includes(` ${whole} `) ? 1 : 0;
  }
  const inExcerpt = new Set(tokens(excerpt));
  return words.filter((word) => inExcerpt.has(word)).length / words.length;
}

export function isGrounded(answer: string, excerpt: string, min: number = GROUNDED_MIN): boolean {
  return groundedness(answer, excerpt) >= min;
}
