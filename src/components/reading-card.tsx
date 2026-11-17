"use client";

import { useState, useTransition } from "react";
import { READ_STATUSES, MAX_TAKEAWAY, readStatusLabel, tidyTakeaway, type ReadStatus } from "@/lib/reading";
import { setReadingAction } from "@/actions/reading";

/**
 * Where a work is in the person's reading: to read, reading or done, and what they would tell themselves about it in one line (ROADMAP
 * item 43). Nothing is saved until Save is pressed. The server checks and tidies the takeaway again; the counter here is the same rule.
 */
export function ReadingCard({ id, status: initialStatus, takeaway: initialTakeaway }: { id: string; status: ReadStatus; takeaway: string | null }) {
  const [status, setStatus] = useState<ReadStatus>(initialStatus);
  const [takeaway, setTakeaway] = useState(initialTakeaway ?? "");
  const [saved, setSaved] = useState<{ status: ReadStatus; takeaway: string } | null>({ status: initialStatus, takeaway: initialTakeaway ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const length = tidyTakeaway(takeaway)?.length ?? 0;
  const tooLong = length > MAX_TAKEAWAY;
  const unchanged = saved !== null && saved.status === status && (tidyTakeaway(saved.takeaway) ?? "") === (tidyTakeaway(takeaway) ?? "");

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setReadingAction(id, { status, takeaway: takeaway === "" ? null : takeaway });
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        setSaved({ status: result.data.status as ReadStatus, takeaway: result.data.takeaway ?? "" });
        setTakeaway(result.data.takeaway ?? "");
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <section aria-labelledby={`reading-${id}`} className="mt-3 flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-4">
      <h2 id={`reading-${id}`} className="text-sm font-semibold text-text">
        Reading
      </h2>
      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {READ_STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={status === option}
            disabled={pending}
            onClick={() => setStatus(option)}
            className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold transition-colors ${
              status === option ? "border-accent bg-accent-soft text-accent-ink" : "border-control bg-surface text-text hover:bg-surface-subtle"
            }`}
          >
            {readStatusLabel(option)}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`takeaway-${id}`} className="text-sm font-semibold text-text">
          One-line takeaway
        </label>
        <input
          id={`takeaway-${id}`}
          type="text"
          value={takeaway}
          disabled={pending}
          onChange={(event) => setTakeaway(event.target.value)}
          aria-describedby={`takeaway-help-${id}`}
          aria-invalid={tooLong}
          className="min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-[15px] text-text"
        />
        <p id={`takeaway-help-${id}`} className="flex flex-wrap justify-between gap-x-3 text-xs text-text-muted">
          <span>What you would tell yourself in a year. Optional.</span>
          <span className={tooLong ? "font-semibold text-danger" : undefined}>
            {length} / {MAX_TAKEAWAY}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || tooLong || unchanged}
          onClick={save}
          className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <p role="status" className={`text-sm ${error ? "font-semibold text-danger" : "font-semibold text-ok"}`}>
          {error ?? (unchanged ? "Saved." : "")}
        </p>
      </div>
    </section>
  );
}
