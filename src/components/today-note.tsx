"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openTodayNoteAction } from "@/actions/daily";
import { Icon } from "@/components/icons";

/**
 * The inside of the Today page's "Today's note" card. If today's note exists it
 * links to it; if not, it offers to make one. Making it is always a click, never
 * something a page load does.
 */
export function TodayNote({
  existing,
  dayLabel,
}: {
  existing: { id: string; title: string; editedLabel: string } | null;
  /** "Wed 28 Oct", for the line that says what the note will start with. */
  dayLabel: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <h2 id="today-note-title" className="text-xs font-semibold text-text-faint">
        Today&apos;s note
      </h2>

      {existing ? (
        <>
          <Link
            href={`/notes/${existing.id}`}
            className="mt-1 block text-lg font-bold leading-snug text-text hover:text-accent-ink"
          >
            {existing.title}
          </Link>
          <p className="text-sm text-text-muted">Edited {existing.editedLabel}</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-text-muted">
            Starts a note for {dayLabel} with your schedule and open tasks.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await openTodayNoteAction();
                if (result.success) router.push(`/notes/${result.data.id}`);
                else setError(result.error.message);
              });
            }}
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
          >
            <Icon name="notes" />
            {pending ? "Opening…" : "Open today's note"}
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
