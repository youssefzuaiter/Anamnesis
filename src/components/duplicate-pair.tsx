"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { keepBothAction, mergeNotesAction } from "@/actions/duplicates";
import type { MergeResult } from "@/services/duplicate-service";

export type PairView = {
  key: string;
  kind: "same-text" | "same-ideas";
  similarity: number | null;
  suggestedKeepId: string;
  notes: [NoteView, NoteView];
};
export type NoteView = { id: string; title: string; editedAt: number; edited: string; words: number; tags: string[]; excerpt: string; lacks: number };

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const primary = `${button} bg-accent text-on-accent hover:bg-accent-hover`;
const quiet = `${button} border border-control text-text hover:bg-surface-subtle`;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * One pair of notes that look like the same note (ROADMAP item 36). Choosing which to keep, then Merge, then a plain
 * confirmation that says what will happen; nothing changes before that last click. "Keep both" hides the pair for good.
 */
export function DuplicatePair({ pair, onDone }: { pair: PairView; onDone: (message: string) => void }) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(pair.suggestedKeepId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const keep = pair.notes.find((note) => note.id === keepId) ?? pair.notes[0];
  const drop = pair.notes.find((note) => note.id !== keep.id) ?? pair.notes[1];

  async function run(work: () => Promise<{ success: boolean; error?: { message: string } | null; message?: string }>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (!result.success) return setError(result.error?.message ?? "That did not work. Try again.");
      // The list keeps this message in place of the pair: the refresh below takes the pair out of the page.
      onDone(result.message ?? "Done.");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  const summary = (result: MergeResult) =>
    [
      `Merged into “${keep.title}”. “${drop.title}” is in the trash.`,
      result.addedBlocks > 0 ? `${plural(result.addedBlocks, "paragraph was", "paragraphs were")} added under “Merged from”.` : null,
      result.linksRewritten > 0 ? `${plural(result.linksRewritten, "link was", "links were")} pointed at the kept note.` : null,
      result.tasks + result.cards + result.attachments > 0
        ? `Moved ${plural(result.tasks, "task", "tasks")}, ${plural(result.cards, "card", "cards")} and ${plural(result.attachments, "attachment", "attachments")}.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <li role="group" aria-label={`${pair.notes[0].title} and ${pair.notes[1].title}`} className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-4">
      <p className="text-sm font-medium text-text">
        {pair.kind === "same-text" ? "Same text" : "Same ideas, different words"}
        <span className="font-normal text-text-muted">
          {pair.similarity === null ? " · identical wording" : ` · ${Math.round(pair.similarity * 100)}% alike in meaning`}
        </span>
      </p>

      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2" disabled={busy}>
        <legend className="sr-only">Which note to keep</legend>
        {pair.notes.map((note) => (
          <label
            key={note.id}
            className={`flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border p-3 text-sm ${keepId === note.id ? "border-accent bg-accent-soft" : "border-border-subtle"}`}
          >
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name={`keep-${pair.key}`}
                checked={keepId === note.id}
                onChange={() => {
                  setKeepId(note.id);
                  setConfirming(false);
                }}
                className="mt-1 size-4 accent-accent"
              />
              <span className="min-w-0">
                <span className="block break-words font-semibold text-text">Keep “{note.title}”</span>
                <span className="block text-xs text-text-muted">
                  {plural(note.words, "word", "words")} · edited {note.edited}
                  {note.tags.length > 0 ? ` · ${note.tags.map((tag) => `#${tag}`).join(" ")}` : ""}
                </span>
              </span>
            </span>
            <span className="break-words pl-7 text-text-muted">{note.excerpt || "No text."}</span>
            <Link href={`/notes/${note.id}`} target="_blank" rel="noopener" className="pl-7 text-xs font-medium text-accent hover:underline">
              Open this note in a new tab
            </Link>
          </label>
        ))}
      </fieldset>

      <p className="text-sm text-text-muted">
        {drop.lacks > 0
          ? `“${drop.title}” has ${plural(drop.lacks, "paragraph", "paragraphs")} that “${keep.title}” does not. Merging adds ${drop.lacks === 1 ? "it" : "them"} to the end of “${keep.title}”, under a heading, so nothing is lost.`
          : `Everything “${drop.title}” says is already in “${keep.title}”.`}
      </p>

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-subtle p-3 text-sm text-text">
          <p>
            “{drop.title}” will go to the trash, where you can restore it. Its tasks, flashcards, attachments and the links to it move to “{keep.title}”.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={primary}
              onClick={() =>
                run(async () => {
                  const result = await mergeNotesAction({ keepId: keep.id, dropId: drop.id, keepUpdatedAt: keep.editedAt, dropUpdatedAt: drop.editedAt });
                  return result.success ? { success: true, message: summary(result.data) } : result;
                })
              }
            >
              {busy ? "Merging…" : "Merge now"}
            </button>
            <button type="button" disabled={busy} className={quiet} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={primary} onClick={() => setConfirming(true)}>
            Merge into “{keep.title.length > 30 ? `${keep.title.slice(0, 30)}…` : keep.title}”
          </button>
          <button
            type="button"
            disabled={busy}
            className={quiet}
            onClick={() =>
              run(async () => {
                const result = await keepBothAction({ a: pair.notes[0].id, b: pair.notes[1].id });
                return result.success ? { success: true, message: "Kept both. This pair will not be offered again." } : result;
              })
            }
          >
            Keep both
          </button>
        </div>
      )}

      {error && (
        <p role="group" aria-label="Problem" aria-live="assertive" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** The pairs, each replaced by what happened to it once it is dealt with, so a confirmation is not lost when the page refreshes. */
export function DuplicateList({ pairs, empty }: { pairs: PairView[]; empty: ReactNode }) {
  // The pairs as they were when the page opened: a refresh takes a dealt-with pair out of `pairs`, but its message stays here.
  const [known] = useState<PairView[]>(pairs);
  const [done, setDone] = useState<Record<string, string>>({});

  if (known.length === 0) return <>{empty}</>;
  return (
    <ul aria-label="Pairs of notes" className="mt-6 flex flex-col gap-4">
      {known.map((pair) => {
        const message = done[pair.key];
        if (message !== undefined) {
          return (
            <li
              key={pair.key}
              role="group"
              aria-label={`${pair.notes[0].title} and ${pair.notes[1].title}, done`}
              aria-live="polite"
              className="rounded-xl border border-border-subtle bg-surface p-4 text-sm text-text"
            >
              {message}
            </li>
          );
        }
        // A pair that is no longer offered (changed elsewhere) is not shown as if it still needed a decision.
        if (!pairs.some((live) => live.key === pair.key)) return null;
        return <DuplicatePair key={pair.key} pair={pair} onDone={(text) => setDone((prev) => ({ ...prev, [pair.key]: text }))} />;
      })}
    </ul>
  );
}
