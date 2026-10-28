"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  applyShutdownAction,
  proposeShutdownAction,
  type ShutdownTaskView,
  type ShutdownView,
} from "@/actions/daily";
import { Icon } from "@/components/icons";
import { TASKS_CHANGED_EVENT } from "@/lib/domain";

const word = (priority: string) => priority.charAt(0).toUpperCase() + priority.slice(1);
const plural = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

/**
 * Moves unfinished tasks to tomorrow, in one confirmed step. Shaped like Plan
 * my day: ask, look, then confirm. Tasks due today start ticked; overdue ones
 * from earlier days start unticked, so tidying the backlog is the person's call.
 */
export function ShutDownDay() {
  const router = useRouter();
  const [view, setView] = useState<ShutdownView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function group(legend: string, tasks: ShutdownTaskView[], note?: string) {
    if (tasks.length === 0) return null;
    return (
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1 text-xs font-semibold text-text-muted">{legend}</legend>
        {note && <p className="mb-1 text-xs text-text-muted">{note}</p>}
        {tasks.map((task) => (
          <label
            key={task.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-surface px-3 py-1.5 text-sm transition-colors hover:bg-surface-subtle"
          >
            <input
              type="checkbox"
              checked={selected.has(task.id)}
              onChange={() => toggle(task.id)}
              className="size-5 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-text">{task.title}</span>
              <span className="block text-xs leading-normal text-text-muted">
                <span className={task.priority === "high" ? "font-semibold text-warn" : ""}>
                  {word(task.priority)}
                </span>
                {task.detail ? ` · ${task.detail}` : ""}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <section aria-labelledby="shutdown-title" className="rounded-xl bg-surface-subtle p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-56 flex-1">
          <h3 id="shutdown-title" className="text-sm font-semibold text-text">
            Shut down day
          </h3>
          <p className="text-xs text-text-muted">
            Moves unfinished tasks to tomorrow. Nothing moves until you confirm.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          aria-expanded={view !== null}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await proposeShutdownAction();
              if (!result.success) {
                setError(result.error.message);
                return;
              }
              const { dueToday, overdue } = result.data;
              if (dueToday.length + overdue.length === 0) {
                setView(null);
                setMessage("Nothing left to carry over.");
                return;
              }
              setView(result.data);
              setSelected(new Set(dueToday.map((task) => task.id)));
            });
          }}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          <Icon name="moon" />
          {pending && view === null ? "Working…" : "Review unfinished tasks"}
        </button>
      </div>

      {view && (
        <div className="mt-3.5 flex flex-col gap-3.5">
          <div>
            <h4 className="text-sm font-bold text-text">Move unfinished tasks to tomorrow?</h4>
            <p className="mt-0.5 text-xs leading-normal text-text-muted">
              They move to {view.tomorrowLabel}. Done tasks stay, events are untouched, and a
              planned time today is cleared.
            </p>
          </div>

          {group("Due today", view.dueToday)}
          {group(
            "Overdue from earlier",
            view.overdue,
            "These stay where they are unless you tick them.",
          )}

          <div className="flex flex-wrap items-center gap-3">
            {selected.size > 0 ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await applyShutdownAction([...selected]);
                    if (result.success) {
                      setView(null);
                      setMessage(
                        `Moved ${plural(result.data.moved)} to ${result.data.tomorrowLabel}. Open Today tomorrow and use Plan my day to place them.`,
                      );
                      router.refresh();
                      window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
                    } else {
                      setError(result.error.message);
                    }
                  });
                }}
                className="min-h-11 rounded-lg bg-accent px-4.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Moving…" : `Move ${plural(selected.size)} to ${view.tomorrowLabel}`}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="min-h-11 cursor-not-allowed rounded-lg border border-border-strong bg-surface px-4.5 text-sm font-semibold text-text-faint"
              >
                Nothing selected
              </button>
            )}
            <button
              type="button"
              onClick={() => setView(null)}
              className="min-h-11 rounded-lg px-3.5 text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm text-text-muted">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
