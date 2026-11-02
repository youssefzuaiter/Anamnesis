import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { completeJson } from "@/lib/ollama";
import { generatorMessages, judgeMessages, type JudgeInput } from "@/lib/quiz-prompts";
import {
  GROUNDED_MIN,
  QUIZ_DEFAULT_COUNT,
  QUIZ_MAX_COUNT,
  VERDICTS,
  cardQuestion,
  cardReference,
  isGrounded,
  pickQuestionCards,
  ruleVerdict,
  sampleExcerpts,
  verdictToGrade,
  type CheckAnswerInput,
  type CheckResult,
  type Excerpt,
  type QuizQuestion,
  type QuizScope,
  type Verdict,
} from "@/lib/quiz";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import * as noteRepository from "@/repositories/note-repository";
import { resolveScope } from "@/services/scope-service";

/** Cards read to choose a quiz from, and notes read to write questions from. */
const CANDIDATE_CARDS = 200;
const CANDIDATE_NOTES = 30;
/** Passages given to the model in one call, however many questions are missing. */
const MAX_PASSAGES = 8;

// --- The two model calls ------------------------------------------------------------------------
//
// Both return what the model said, unchecked (`unknown`). The checks live in one place each,
// below, so a judge or generator passed in by a test is held to the same rules as the real one.

export type { JudgeInput };
export type Judge = (input: JudgeInput) => Promise<unknown>;
export type Generator = (excerpts: Excerpt[], count: number) => Promise<unknown>;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: [...VERDICTS] },
    feedback: { type: "string" },
  },
  required: ["verdict", "feedback"],
} as const;

const GENERATOR_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          reference: { type: "string" },
          excerptIndex: { type: "integer" },
        },
        required: ["question", "reference", "excerptIndex"],
      },
    },
  },
  required: ["questions"],
} as const;

/** Marks an answer the rules could not decide. Returns the model's JSON, unchecked. */
export const modelJudge: Judge = (input) => completeJson(judgeMessages(input), JUDGE_SCHEMA);

/** Writes questions from passages. Returns the model's list, unchecked. */
export const modelGenerator: Generator = async (excerpts, count) => {
  const raw = await completeJson(generatorMessages(excerpts, count), GENERATOR_SCHEMA);
  return typeof raw === "object" && raw !== null && "questions" in raw ? raw.questions : undefined;
};

// --- Starting a quiz ---------------------------------------------------------------------------

export type StartResult = { label: string; questions: QuizQuestion[]; notice: string | null };

const generatedItemSchema = z.object({
  question: z.string().trim().min(10).max(300),
  reference: z.string().trim().min(1).max(500),
  excerptIndex: z.number().int().min(0),
});

type TopUp = {
  questions: QuizQuestion[];
  outcome: "ok" | "no-text" | "unreachable" | "unusable";
};

/**
 * Writes the questions the cards could not supply. Whatever the model returns is checked here:
 * each item must have the right shape, point at a passage that was offered, and be made of words
 * from that passage; the rest are dropped.
 */
async function topUp(
  userId: string,
  noteIds: string[],
  need: number,
  seed: number,
  groundedMin: number,
  generator: Generator,
): Promise<TopUp> {
  const notes = await noteRepository.listNoteTexts(userId, noteIds, CANDIDATE_NOTES);
  const excerpts = sampleExcerpts(notes, Math.min(need * 2, MAX_PASSAGES), seed);
  if (excerpts.length === 0) return { questions: [], outcome: "no-text" };

  let raw: unknown;
  try {
    raw = await generator(excerpts, need);
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_UNAVAILABLE") return { questions: [], outcome: "unreachable" };
    if (error instanceof AppError && error.code === "AI_OUTPUT_INVALID") return { questions: [], outcome: "unusable" };
    throw error;
  }

  const questions: QuizQuestion[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const parsed = generatedItemSchema.safeParse(item);
    if (!parsed.success) continue;
    const excerpt = excerpts[parsed.data.excerptIndex];
    if (!excerpt || !isGrounded(parsed.data.reference, excerpt.text, groundedMin)) continue;
    questions.push({
      kind: "generated",
      id: randomUUID(),
      noteId: excerpt.noteId,
      noteTitle: excerpt.noteTitle,
      question: parsed.data.question,
      reference: parsed.data.reference,
      excerpt: excerpt.text,
    });
    if (questions.length === need) break;
  }
  return { questions, outcome: questions.length === 0 ? "unusable" : "ok" };
}

function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

/**
 * The questions for a quiz over one note or course. The person's own cards come first (no model,
 * and the reference is theirs); only if they are fewer than asked for does the model write the
 * rest from the scope's notes. The scope is resolved first, so another account's id is refused
 * before anything is read. If the model cannot help, the quiz is the cards it could find, with a
 * notice saying why it is short.
 */
export async function startQuiz(
  userId: string,
  scope: QuizScope,
  options: { count?: number; now?: Date; seed?: number; groundedMin?: number } = {},
  generator: Generator = modelGenerator,
): Promise<StartResult> {
  const asked = Number.isFinite(options.count) ? Math.trunc(options.count as number) : QUIZ_DEFAULT_COUNT;
  const count = Math.min(Math.max(asked, 1), QUIZ_MAX_COUNT);
  const now = options.now ?? new Date();

  const resolved = await resolveScope(userId, scope);
  const noteIds = resolved.within.note ?? [];

  const cards = await flashcardRepository.listForNotes(userId, noteIds, CANDIDATE_CARDS);
  const questions: QuizQuestion[] = pickQuestionCards(cards, count, now).map((card) => ({
    kind: "card",
    id: card.id,
    noteId: card.noteId,
    question: cardQuestion(card),
  }));

  let outcome: TopUp["outcome"] | "enough" = "enough";
  if (questions.length < count) {
    const more = await topUp(
      userId,
      noteIds,
      count - questions.length,
      options.seed ?? dayOfYear(now),
      options.groundedMin ?? GROUNDED_MIN,
      generator,
    );
    questions.push(...more.questions);
    outcome = more.outcome;
  }

  return { label: resolved.label, questions, notice: noticeFor(outcome, questions.length, count, scope.kind) };
}

function noticeFor(
  outcome: TopUp["outcome"] | "enough",
  made: number,
  count: number,
  kind: QuizScope["kind"],
): string | null {
  if (made >= count) return null;
  const none = made === 0;
  switch (outcome) {
    case "no-text":
      return none
        ? `Nothing to quiz yet: make some cards or write more in this ${kind}.`
        : "Not enough written material to make more questions.";
    case "unreachable":
      return none
        ? "The model could not be reached, and there are no cards to ask yet. Start Ollama or make some cards."
        : "The model could not be reached, so this quiz uses only your existing cards.";
    case "unusable":
      return none
        ? "The model did not return usable questions, and there are no cards to ask yet. Try again."
        : "The model did not return usable questions, so this quiz uses only your existing cards.";
    default:
      return `Only ${made} of the ${count} questions could be made.`;
  }
}

// --- Checking an answer ------------------------------------------------------------------------

const judgeResultSchema = z.object({
  verdict: z.enum(VERDICTS),
  feedback: z.string().trim().min(1).max(400),
});

const RULE_FEEDBACK: Record<Verdict, string> = {
  correct: "That matches the answer.",
  partly: "",
  incorrect: "No answer was given.",
};

function noVerdict(reference: string, problem: "unavailable" | "invalid"): CheckResult {
  return { reference, decidedBy: "none", verdict: null, feedback: null, suggestedGrade: null, problem };
}

/**
 * Checks one answer. A card is read from the database by id, owned by the caller and not in the
 * trash, so its reference never comes from the browser; a generated question carries its own text.
 * Rules decide what they can; the model judges the rest. A verdict is a suggestion and nothing
 * here records a grade. If the model cannot judge, the result says so and still carries the
 * reference, so the person can grade themselves.
 */
export async function checkAnswer(
  userId: string,
  input: CheckAnswerInput,
  judge: Judge = modelJudge,
): Promise<CheckResult> {
  let question: string;
  let reference: string;
  let excerpt: string | null;

  if (input.kind === "card") {
    const card = await flashcardRepository.getLiveCard(userId, input.cardId);
    if (!card) throw new AppError("RESOURCE_NOT_FOUND", "That card no longer exists.");
    question = cardQuestion(card);
    reference = cardReference(card);
    excerpt = null;
  } else {
    question = input.question;
    reference = input.reference;
    excerpt = input.excerpt === "" ? null : input.excerpt;
  }

  const byRule = ruleVerdict(input.answer, reference);
  if (byRule) {
    return {
      reference,
      decidedBy: "rule",
      verdict: byRule,
      feedback: RULE_FEEDBACK[byRule],
      suggestedGrade: verdictToGrade(byRule),
      problem: null,
    };
  }

  let raw: unknown;
  try {
    raw = await judge({ question, reference, excerpt, answer: input.answer });
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_UNAVAILABLE") return noVerdict(reference, "unavailable");
    if (error instanceof AppError && error.code === "AI_OUTPUT_INVALID") return noVerdict(reference, "invalid");
    throw error;
  }

  const verdict = judgeResultSchema.safeParse(raw);
  if (!verdict.success) return noVerdict(reference, "invalid");
  return {
    reference,
    decidedBy: "model",
    verdict: verdict.data.verdict,
    feedback: verdict.data.feedback,
    suggestedGrade: verdictToGrade(verdict.data.verdict),
    problem: null,
  };
}
