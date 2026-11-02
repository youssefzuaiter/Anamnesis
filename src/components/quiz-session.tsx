"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { reviewCardAction } from "@/actions/flashcards";
import { checkAnswerAction, startQuizAction } from "@/actions/quiz";
import {
  MAX_ANSWER_CHARS,
  gradeToVerdict,
  scoreSession,
  type CheckResult,
  type QuizQuestion,
  type QuizScope,
  type Verdict,
} from "@/lib/quiz";
import { REVIEW_GRADES, type ReviewGrade } from "@/lib/spaced-repetition";

type Phase = "idle" | "asking" | "checked" | "done";
type Finished = { question: QuizQuestion; verdict: Verdict };

const VERDICT_WORDS: Record<Verdict, string> = {
  correct: "Correct",
  partly: "Partly right",
  incorrect: "Not quite",
};
const GRADE_LABEL: Record<ReviewGrade, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
/** What a generated question offers in place of the four card grades: nothing about it is stored. */
const OUTCOMES: { verdict: Verdict; label: string }[] = [
  { verdict: "correct", label: "I knew it" },
  { verdict: "partly", label: "Partly" },
  { verdict: "incorrect", label: "Missed it" },
];

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle disabled:opacity-60";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60";

/** A quiet action that still has a phone-sized target. */
const TEXT_BUTTON =
  "inline-flex min-h-11 items-center rounded-lg px-2 text-xs text-text-muted transition-colors hover:text-text disabled:opacity-60";

const showScore = (score: number) => (Number.isInteger(score) ? String(score) : score.toFixed(1));

/**
 * One quiz over a note or a course. The server picks the questions and suggests a verdict for each
 * answer; this component only walks through them. Nothing is recorded unless the person chooses a
 * grade for a card, and that goes through the same action the review screen uses.
 */
export function QuizSession({ scope, label }: { scope: QuizScope; label: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(5);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [finished, setFinished] = useState<Finished[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // The result is where the person's attention should be as soon as it appears.
  useEffect(() => {
    if (phase === "checked") resultRef.current?.focus();
  }, [phase]);

  /** One server call at a time: a double click must not run it twice, and a failure must not leave it stuck. */
  function run(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        await work();
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  function begin() {
    run(async () => {
      const response = await startQuizAction(scope, count);
      if (!response.success) {
        setError(response.error.message);
        return;
      }
      setQuestions(response.data.questions);
      setNotice(response.data.notice);
      setIndex(0);
      setAnswer("");
      setResult(null);
      setFinished([]);
      setPhase(response.data.questions.length > 0 ? "asking" : "idle");
    });
  }

  const question = questions[index];

  function check() {
    if (!question) return;
    run(async () => {
      const response = await checkAnswerAction(
        question.kind === "card"
          ? { kind: "card", cardId: question.id, answer }
          : {
              kind: "generated",
              question: question.question,
              reference: question.reference,
              excerpt: question.excerpt,
              answer,
            },
      );
      if (!response.success) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
      setPhase("checked");
    });
  }

  /** Moves on, after recording the grade the person chose (cards only) and noting how the question went. */
  function settle(verdict: Verdict, grade: ReviewGrade | null) {
    if (!question) return;
    run(async () => {
      if (grade !== null && question.kind === "card") {
        const response = await reviewCardAction(question.id, grade);
        if (!response.success) {
          setError(response.error.message);
          return;
        }
      }
      setFinished((done) => [...done, { question, verdict }]);
      if (index + 1 < questions.length) {
        setIndex(index + 1);
        setAnswer("");
        setResult(null);
        setPhase("asking");
      } else {
        setPhase("done");
      }
    });
  }

  if (phase === "idle") {
    return (
      <section aria-label="Start a quiz" className="rounded-xl border border-border-subtle bg-surface px-5 py-5">
        <p className="text-sm text-text">
          Quiz on <strong className="font-semibold">{label}</strong>
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Your cards come first. If there are not enough, the model writes the rest from your notes. Nothing is
          saved unless you choose a grade for a card.
        </p>

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-xs font-semibold text-text-faint">How many questions</legend>
          <div className="flex flex-wrap gap-2">
            {[5, 10].map((value) => (
              <label
                key={value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-control px-4 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name="count"
                  value={value}
                  checked={count === value}
                  onChange={() => setCount(value)}
                  className="accent-[var(--accent)]"
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        {notice && <p className="mt-4 text-sm text-text-muted">{notice}</p>}
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-5">
          <button type="button" onClick={begin} disabled={pending} className={PRIMARY}>
            {pending ? "Starting…" : "Start quiz"}
          </button>
        </div>
      </section>
    );
  }

  if (phase === "done") {
    const summary = scoreSession(finished.map((entry) => entry.verdict));
    return (
      <section aria-label="Results" className="rounded-xl border border-border-subtle bg-surface px-5 py-5">
        {summary.total === 0 ? (
          <p className="text-base font-semibold text-text">You did not answer any questions.</p>
        ) : (
          <>
            <p className="text-lg font-semibold text-text">
              You scored {showScore(summary.score)} of {summary.total}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {summary.correct} correct · {summary.partly} partly right · {summary.incorrect} not quite
            </p>
            <ol className="mt-4 flex flex-col gap-2.5">
              {finished.map(({ question: asked, verdict }) => (
                <li key={asked.id} className="text-sm text-text">
                  <span className="font-semibold">{VERDICT_WORDS[verdict]}</span> — {asked.question}
                  {asked.noteId && (
                    <>
                      {" "}
                      <Link href={`/notes/${asked.noteId}`} className="text-accent hover:underline">
                        Open the note
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={begin} disabled={pending} className={PRIMARY}>
            {pending ? "Starting…" : "Quiz again"}
          </button>
          <Link
            href={scope.kind === "note" ? `/notes/${scope.id}` : `/courses/${scope.id}`}
            className="text-sm text-accent hover:underline"
          >
            Back to the {scope.kind}
          </Link>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </section>
    );
  }

  // asking or checked: there is always a question here.
  if (!question) return null;
  const suggested = result?.suggestedGrade ?? null;
  const suggestedVerdict = result?.verdict ?? null;

  // How the person says it went: a card's four grades, or three outcomes for a question that is not stored.
  const choices =
    question.kind === "card"
      ? REVIEW_GRADES.map((grade) => ({
          key: grade,
          label: GRADE_LABEL[grade],
          suggested: grade === suggested,
          choose: () => settle(gradeToVerdict(grade), grade),
        }))
      : OUTCOMES.map(({ verdict, label: outcome }) => ({
          key: verdict,
          label: outcome,
          suggested: verdict === suggestedVerdict,
          choose: () => settle(verdict, null),
        }));

  return (
    <section aria-label="Quiz" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          Question {index + 1} of {questions.length}
        </p>
        <button type="button" onClick={() => setPhase("done")} disabled={pending} className={`${TEXT_BUTTON} -mr-2`}>
          End quiz
        </button>
      </div>
      {notice && index === 0 && <p className="text-xs text-text-muted">{notice}</p>}

      <div className="rounded-2xl border border-border-subtle bg-surface p-5">
        <p className="whitespace-pre-line text-base font-medium text-text">{question.question}</p>

        {phase === "asking" ? (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              check();
            }}
          >
            <label htmlFor="quiz-answer" className="text-xs font-semibold text-text-faint">
              Your answer
            </label>
            <textarea
              id="quiz-answer"
              value={answer}
              rows={4}
              maxLength={MAX_ANSWER_CHARS}
              onChange={(event) => setAnswer(event.target.value)}
              className="min-h-11 w-full resize-y rounded-lg border border-control bg-surface px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
            />
            <p className="text-xs text-text-muted">Leave it empty if you do not know.</p>
            <div>
              <button type="submit" disabled={pending} className={PRIMARY}>
                {pending ? "Checking…" : "Check answer"}
              </button>
            </div>
          </form>
        ) : (
          result && (
            <div ref={resultRef} role="status" tabIndex={-1} className="mt-4 flex flex-col gap-2 outline-none">
              <h2 className="text-base font-semibold text-text">
                {result.verdict ? VERDICT_WORDS[result.verdict] : "The model could not judge this"}
              </h2>
              {result.feedback && <p className="text-sm text-text">{result.feedback}</p>}
              {result.problem && (
                <p className="text-sm text-text-muted">
                  {result.problem === "unavailable"
                    ? "The model could not be reached, so grade this one yourself."
                    : "The model's reply could not be used, so grade this one yourself."}
                </p>
              )}
              <p className="text-sm text-text-muted">The answer: {result.reference}</p>
              {question.kind === "generated" && (
                <p className="text-xs text-text-muted">
                  From{" "}
                  <Link href={`/notes/${question.noteId}`} className="text-accent hover:underline">
                    {question.noteTitle}
                  </Link>
                </p>
              )}
            </div>
          )
        )}
      </div>

      {phase === "checked" && result && (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Grade this question" className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                disabled={pending}
                onClick={choice.choose}
                className={choice.suggested ? PRIMARY : BUTTON}
              >
                {choice.label}
                {choice.suggested ? " (suggested)" : ""}
              </button>
            ))}
          </div>
          {question.kind === "card" && suggestedVerdict && (
            <div className="-ml-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => settle(suggestedVerdict, null)}
                className={TEXT_BUTTON}
              >
                Next without grading
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
