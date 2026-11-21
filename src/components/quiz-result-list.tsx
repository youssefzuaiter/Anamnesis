"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { keepQuestionAction } from "@/actions/quiz";
import { canKeep, type QuizQuestion, type Verdict } from "@/lib/quiz";

export type FinishedQuestion = { question: QuizQuestion; verdict: Verdict };

const VERDICT_WORDS: Record<Verdict, string> = {
  correct: "Correct",
  partly: "Partly right",
  incorrect: "Not quite",
};

type Kept = { state: "kept" | "existing" } | { state: "error"; message: string };

/**
 * The questions of a finished quiz, how each went, and "Keep as a card" on a generated one that was not answered right: it becomes an ordinary
 * card on its note, so it is reviewed, and can be a weak spot. Only what the person sees is sent (the note, the question, its answer).
 */
export function QuizResultList({ finished }: { finished: FinishedQuestion[] }) {
  const [kept, setKept] = useState<Record<string, Kept>>({});
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  function keep(question: Extract<QuizQuestion, { kind: "generated" }>) {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const response = await keepQuestionAction({ noteId: question.noteId, question: question.question, reference: question.reference });
        setKept((current) => ({
          ...current,
          [question.id]: response.success ? { state: response.data.existing ? "existing" : "kept" } : { state: "error", message: response.error.message },
        }));
      } catch {
        setKept((current) => ({ ...current, [question.id]: { state: "error", message: "Could not reach the server. Try again." } }));
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <ol className="mt-4 flex flex-col gap-3">
      {finished.map(({ question: asked, verdict }) => {
        const result = kept[asked.id];
        return (
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
            {asked.kind === "generated" && canKeep(asked.kind, verdict) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {result?.state === "kept" || result?.state === "existing" ? (
                  <p role="status" className="text-xs font-semibold text-ok">
                    {result.state === "kept" ? "Kept as a card." : "Already a card."}{" "}
                    <Link href="/cards/all" className="font-normal text-accent hover:underline">See your cards</Link>
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => keep(asked)}
                      disabled={pending}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle disabled:opacity-60 sm:min-h-9"
                    >
                      Keep as a card
                    </button>
                    {result?.state === "error" && (
                      <p role="alert" className="text-xs font-semibold text-danger">{result.message}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
