"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addLinkAction } from "@/actions/link-suggestions";
import { RAIL_CARD } from "@/components/rail-card";

export type LinkRow = {
  id: string;
  title: string;
  /** Why it is offered; null when the snippet says it all. */
  reason: string | null;
  snippet: string | null;
};

type Done = { row: LinkRow; added: boolean; index: number };

/**
 * A rail card of notes to link, each with a button. Clicking is the only thing that
 * writes. Rendering never does.
 *
 * The page refreshes after a click and the note drops out of the list it came from,
 * so the confirmation is kept here, in the row, rather than in the list: otherwise
 * it would vanish with the row, and with the whole card after the last one. The page
 * therefore always mounts this component and it hides itself when it has nothing to
 * show.
 */
export function LinkCard({
  heading,
  help,
  buttonLabel,
  writesInto,
  noteId,
  rows,
}: {
  heading: string;
  help?: string;
  buttonLabel: string;
  /** "this": the button adds the listed note to this note. "listed": it adds this note to the listed one. */
  writesInto: "this" | "listed";
  noteId: string;
  rows: LinkRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");

  // The rows still offered, with each confirmed one back in the place it had.
  const list: { row: LinkRow; done: Done | null }[] = rows
    .filter((row) => !done[row.id])
    .map((row) => ({ row, done: null }));
  for (const entry of Object.values(done).sort((a, b) => a.index - b.index)) {
    list.splice(Math.min(entry.index, list.length), 0, { row: entry.row, done: entry });
  }

  if (list.length === 0) return null;

  function add(row: LinkRow, index: number) {
    setBusyId(row.id);
    setErrors((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    startTransition(async () => {
      const [fromId, toId] = writesInto === "this" ? [noteId, row.id] : [row.id, noteId];
      const result = await addLinkAction(fromId, toId);
      setBusyId(null);
      if (!result.success) {
        setErrors((current) => ({ ...current, [row.id]: result.error.message }));
        return;
      }
      setDone((current) => ({ ...current, [row.id]: { row, added: result.data.added, index } }));
      setAnnouncement(
        `${row.title}: ${result.data.added ? "Added to See also." : "Already linked."}`,
      );
      router.refresh();
    });
  }

  return (
    <section className={RAIL_CARD}>
      <h2 className="mb-1.5 text-xs font-semibold text-text-faint">{heading}</h2>
      {help && <p className="mb-2 text-xs text-text-muted">{help}</p>}

      <ul className="flex flex-col gap-2">
        {list.map(({ row, done: finished }, index) => (
          <li key={row.id} className="rounded-lg border border-border-subtle p-3">
            <Link
              href={`/notes/${row.id}`}
              className="block truncate text-sm font-medium text-text transition-colors hover:text-accent"
            >
              {row.title}
            </Link>

            {finished ? (
              <p className="mt-1 text-xs text-text-muted">
                {finished.added ? (
                  <>
                    Added to See also. You can undo it from{" "}
                    <Link
                      href={`/notes/${writesInto === "this" ? noteId : row.id}/history`}
                      className="font-medium text-accent hover:underline"
                    >
                      History
                    </Link>
                    .
                  </>
                ) : (
                  "Already linked."
                )}
              </p>
            ) : (
              <>
                {row.reason && <p className="mt-0.5 text-xs text-text-faint">{row.reason}</p>}
                {row.snippet && (
                  <p className="mt-1 line-clamp-2 break-words text-xs text-text-muted">
                    {row.snippet}
                  </p>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => add(row, index)}
                  className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
                >
                  {busyId === row.id ? "Adding…" : buttonLabel}
                </button>
                {errors[row.id] && (
                  <p role="alert" className="mt-1.5 text-xs text-danger">
                    {errors[row.id]}
                  </p>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Mounted with the card, so a screen reader hears each change to it. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
