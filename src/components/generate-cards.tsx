"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { generateCardsAction } from "@/actions/flashcards";

export function GenerateCards({
  noteId,
  existing,
}: {
  noteId: string;
  existing: number;
}) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          setCreated(null);
          startTransition(async () => {
            const result = await generateCardsAction(noteId, 5);
            if (result.success) setCreated(result.data.created);
            else setError(result.error.message);
          });
        }}
        className="rounded-lg border border-border-subtle px-3.5 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
      >
        {pending ? "Writing cards…" : "Make cards"}
      </button>

      <p className="text-xs text-text-muted">
        {existing > 0
          ? `${existing} ${existing === 1 ? "card" : "cards"} from this note`
          : "No cards from this note yet"}
        {" · "}
        <Link href="/cards" className="text-accent hover:underline">
          review queue
        </Link>
      </p>

      {created !== null && (
        <p role="status" className="text-xs text-text-muted">
          Added {created} {created === 1 ? "card" : "cards"}.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
