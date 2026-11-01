import "server-only";
import { z } from "zod";
import { completeJson, type ChatMessage } from "@/lib/ollama";
import { AppError } from "@/lib/api-response";
import { MAX_CARD_ANSWER, MAX_CARD_QUESTION } from "@/lib/domain";
import { answerFor, validateCloze } from "@/lib/cloze";
import { scheduleReview, type ReviewGrade } from "@/lib/spaced-repetition";
import * as courseRepository from "@/repositories/course-repository";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import * as noteRepository from "@/repositories/note-repository";
import type { FlashcardModel as Flashcard } from "@/generated/prisma/models";

/** Enough note for a 3B model to work from without burying the instruction. */
const MAX_SOURCE_CHARS = 6000;
const MAX_CARDS_PER_NOTE = 10;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
    },
  },
  required: ["cards"],
} as const;

// Ollama enforces the shape at decode time; this re-checks the content, since
// a schema-valid response can still be empty strings or a hundred cards.
const modelOutput = z.object({
  cards: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        answer: z.string().trim().min(1).max(600),
      }),
    )
    .default([]),
});

const SYSTEM_PROMPT = [
  "You write study flashcards from a student's own notes.",
  "Each card is one self-contained question and its short answer.",
  "Only use facts stated in the note. Never invent material it does not contain.",
  "Ask about the substance — definitions, mechanisms, distinctions, numbers —",
  "never about the note itself (no 'what is this note about').",
  "A good answer is one or two sentences, not a paragraph.",
].join(" ");

/**
 * Generates cards from a note and stores them. The note text is the user's own
 * content, but it is still quoted rather than concatenated into the
 * instruction, and nothing the model returns reaches the database without
 * passing the schema above — the same posture as the capture parser.
 */
export async function generateCardsForNote(
  userId: string,
  noteId: string,
  requested: number,
): Promise<{ created: number }> {
  const note = await noteRepository.getNote(userId, noteId);
  if (!note) {
    throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");
  }

  const body = note.content.trim();
  if (body.length < 80) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That note is too short to make cards from.",
    );
  }

  const count = Math.min(Math.max(Math.trunc(requested) || 5, 1), MAX_CARDS_PER_NOTE);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Write at most ${count} flashcards from the note below.`,
        "",
        `Note title: ${note.title}`,
        "Note content:",
        '"""',
        body.slice(0, MAX_SOURCE_CHARS),
        '"""',
      ].join("\n"),
    },
  ];

  const parsed = modelOutput.safeParse(
    await completeJson(messages, RESPONSE_SCHEMA),
  );
  if (!parsed.success) {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      "The model did not return usable cards. Try again.",
    );
  }

  const cards = parsed.data.cards.slice(0, count);
  if (cards.length === 0) {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      "No cards could be made from that note.",
    );
  }

  const created = await flashcardRepository.createCards(
    userId,
    cards.map((card) => ({ ...card, noteId: note.id, clozeIndex: null })),
  );
  return { created };
}

export type NewCard =
  | { kind: "basic"; question: string; answer: string }
  | { kind: "cloze"; text: string };

/**
 * Makes the cards a person wrote by hand or from words selected in a note. The text is
 * checked before the note is looked up, so a note id that is not theirs and input that is
 * bad say only that the input is bad. Nothing is written unless all of it is valid, and
 * the note must be the caller's own and not in the trash.
 */
export async function createCardsForNote(
  userId: string,
  noteId: string,
  input: NewCard,
): Promise<{ created: number }> {
  let rows: { question: string; answer: string; clozeIndex: number | null }[];

  if (input.kind === "basic") {
    const question = input.question.trim();
    const answer = input.answer.trim();
    if (question === "" || question.length > MAX_CARD_QUESTION) {
      throw new AppError("VALIDATION_ERROR", `A question is 1 to ${MAX_CARD_QUESTION} characters.`);
    }
    if (answer === "" || answer.length > MAX_CARD_ANSWER) {
      throw new AppError("VALIDATION_ERROR", `An answer is 1 to ${MAX_CARD_ANSWER} characters.`);
    }
    rows = [{ question, answer, clozeIndex: null }];
  } else {
    const check = validateCloze(input.text);
    if (!check.ok) throw new AppError("VALIDATION_ERROR", check.message);
    rows = check.numbers.map((n) => ({
      question: check.text,
      answer: answerFor(check.text, n),
      clozeIndex: n,
    }));
  }

  const note = await noteRepository.getNote(userId, noteId);
  if (!note) throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");

  const created = await flashcardRepository.createCards(
    userId,
    rows.map((row) => ({ ...row, noteId: note.id })),
  );
  return { created };
}

export type DeckSummary = {
  /** The course id, or null for cards in no course. */
  id: string | null;
  label: string;
  title: string | null;
  total: number;
  due: number;
};

/**
 * The caller's decks: each of their courses that has cards, then "No course". The names
 * come from their own courses only; a count for a course that is not among them (it has
 * been deleted) is folded into "No course".
 */
export async function listDecks(userId: string, now: Date): Promise<DeckSummary[]> {
  const [counts, courses] = await Promise.all([
    flashcardRepository.deckCounts(userId, now),
    courseRepository.listCourseOptions(userId),
  ]);
  const byId = new Map(courses.map((course) => [course.id, course]));

  const decks: DeckSummary[] = [];
  const loose = { total: 0, due: 0 };
  for (const count of counts) {
    const course = count.courseId === null ? undefined : byId.get(count.courseId);
    if (course) {
      decks.push({ id: course.id, label: course.code, title: course.title, total: count.total, due: count.due });
    } else {
      loose.total += count.total;
      loose.due += count.due;
    }
  }

  decks.sort((a, b) => b.due - a.due || a.label.localeCompare(b.label));
  if (loose.total > 0) decks.push({ id: null, label: "No course", title: null, ...loose });
  return decks;
}

export async function reviewCard(
  userId: string,
  cardId: string,
  grade: ReviewGrade,
): Promise<Flashcard> {
  const card = await flashcardRepository.getCard(userId, cardId);
  if (!card) {
    throw new AppError("RESOURCE_NOT_FOUND", "That card no longer exists.");
  }

  const next = scheduleReview(
    {
      easeFactor: card.easeFactor,
      intervalDays: card.intervalDays,
      repetitions: card.repetitions,
    },
    grade,
  );

  await flashcardRepository.applyReview(userId, cardId, next);
  return { ...card, ...next, lastReviewed: new Date() };
}

export async function deleteCard(userId: string, cardId: string): Promise<void> {
  const deleted = await flashcardRepository.deleteCard(userId, cardId);
  if (!deleted) {
    throw new AppError("RESOURCE_NOT_FOUND", "That card no longer exists.");
  }
}
