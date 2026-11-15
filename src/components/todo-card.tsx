"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createTodoTasksAction } from "@/actions/todo";

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const primary = `${button} bg-accent text-on-accent hover:bg-accent-hover`;

/**
 * The note's TODO lines, each ticked by default (ROADMAP item 33). Unticking a line keeps it a line. Confirming makes
 * the ticked ones into tasks; the server reads the note again before it creates anything.
 */
export function TodoCard({ noteId, titles }: { noteId: string; titles: string[] }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(titles.map((t) => [t, true])));
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const chosen = titles.filter((title) => ticked[title]);

  async function make() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await createTodoTasksAction({ noteId, titles: chosen });
      if (!result.success) return setError(result.error.message);
      setStatus(result.data.created === 1 ? "Made 1 task." : `Made ${result.data.created} tasks.`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <h2 className="text-base font-bold text-text">Tasks from this note</h2>
      <p className="text-text-muted">Unticked and unchecked lines that are not tasks yet. Untick any you do not want.</p>
      <ul className="flex flex-col gap-2">
        {titles.map((title) => (
          <li key={title}>
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                checked={Boolean(ticked[title])}
                onChange={(event) => {
                  // Read now: the event is gone by the time a state updater runs.
                  const checked = event.currentTarget.checked;
                  setTicked((prev) => ({ ...prev, [title]: checked }));
                }}
                className="mt-1 size-4 accent-accent"
              />
              <span className="min-w-0 break-words text-text">{title}</span>
            </label>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" onClick={make} disabled={busy || chosen.length === 0} className={primary}>
          {chosen.length === 1 ? "Make 1 task" : `Make ${chosen.length} tasks`}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {/* aria-live, not role="status": a note page has more than one status region. */}
      <p aria-live="polite" className="text-xs text-text-muted">
        {status}
      </p>
    </div>
  );
}
