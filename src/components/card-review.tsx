"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { reviewCardAction, deleteCardAction } from "@/actions/flashcards";
import { renderCloze, type ClozePiece } from "@/lib/cloze";
import { REVIEW_GRADES, type ReviewGrade } from "@/lib/spaced-repetition";

export type ReviewCard = {
  id: string;
  question: string;
  answer: string;
  noteId: string | null;
  /** The blank this card hides, or null for a basic card. */
  clozeIndex: number | null;
};

const GRADE_LABEL: Record<ReviewGrade, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

/** A blank is bracketed and a revealed answer is bold and underlined, so neither relies on colour. */
function Piece({ piece }: { piece: ClozePiece }) {
  if (piece.role === "blank") {
    return <span className="rounded bg-surface-subtle px-1 font-semibold">[{piece.text}]</span>;
  }
  if (piece.role === "answer") {
    return <strong className="font-bold text-accent-ink underline decoration-2 underline-offset-4">{piece.text}</strong>;
  }
  return <>{piece.text}</>;
}

export function CardReview({ queue }: { queue: ReviewCard[] }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const card = queue[index];
  const faces = card?.clozeIndex != null ? renderCloze(card.question, card.clozeIndex) : null;

  if (!card) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center">
        <p className="text-sm text-text-muted">
          {queue.length === 0
            ? "Nothing due right now."
            : "That's the queue cleared."}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Cards you answered “Again” come back in about ten minutes.
        </p>
      </div>
    );
  }

  function grade(value: ReviewGrade) {
    setError(null);
    startTransition(async () => {
      const result = await reviewCardAction(card.id, value);
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setRevealed(false);
      setIndex((current) => current + 1);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        {index + 1} of {queue.length} due
      </p>

      <div className="rounded-2xl border border-border-subtle bg-surface p-6">
        {faces ? (
          <p className="whitespace-pre-line text-base font-medium text-text">
            {(revealed ? faces.back : faces.front).map((piece, position) => (
              <Piece key={position} piece={piece} />
            ))}
          </p>
        ) : (
          <p className="text-base font-medium text-text">{card.question}</p>
        )}

        {revealed && !faces && (
          <p className="mt-4 border-t border-border-subtle pt-4 text-sm text-text">
            {card.answer}
          </p>
        )}
        {!revealed && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-4 rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle"
          >
            Show answer
          </button>
        )}
      </div>

      {revealed && (
        <div className="flex flex-wrap gap-2">
          {REVIEW_GRADES.map((value) => (
            <button
              key={value}
              type="button"
              disabled={pending}
              onClick={() => grade(value)}
              className={`rounded-lg px-3.5 py-2 text-sm transition-colors disabled:opacity-60 ${
                value === "again"
                  ? "bg-danger-soft text-danger hover:opacity-80"
                  : value === "good" || value === "easy"
                    ? "bg-accent text-on-accent hover:bg-accent-hover"
                    : "border border-border-subtle text-text hover:bg-surface-subtle"
              }`}
            >
              {GRADE_LABEL[value]}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-3 text-xs text-text-muted">
        {card.noteId && (
          <Link href={`/notes/${card.noteId}`} className="hover:text-text">
            Open the note this came from
          </Link>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm("Delete this card?")) return;
            startTransition(async () => {
              const result = await deleteCardAction(card.id);
              if (!result.success) {
                setError(result.error.message);
                return;
              }
              setRevealed(false);
              setIndex((current) => current + 1);
            });
          }}
          className="hover:text-danger disabled:opacity-60"
        >
          Delete card
        </button>
      </div>
    </div>
  );
}
