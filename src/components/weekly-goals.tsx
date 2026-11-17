"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GoalBar } from "@/components/goal-bar";
import { DEFAULT_TARGET, MAX_TARGET, MEASURE_NAME, goalLabel, needsRecorder, type GoalMeasure } from "@/lib/weekly-goals";
import { addWeeklyGoalAction, removeWeeklyGoalAction, setWeeklyGoalTargetAction } from "@/actions/weekly-goals";
import type { WeeklyGoalsOverview, GoalView } from "@/services/weekly-goal-service";

const BUTTON = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

/** A whole number from 1 to 999 typed as text, or null. Anything else (blank, 2.5, 1e3, text) is not a target. */
function parseTarget(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= MAX_TARGET ? n : null;
}

const RecorderNote = () => (
  <p className="text-[13px] text-text-muted">
    Timer sessions are not being remembered, so this would stay at 0.{" "}
    <Link href="/focus" className="font-semibold text-accent-ink hover:underline">
      Turn it on in Focus
    </Link>
    , or count something else.
  </p>
);

function Past({ goal }: { goal: GoalView }) {
  if (goal.past.total === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <span>Last {goal.past.total} weeks</span>
      <span aria-hidden="true" className="inline-flex gap-[3px]">
        {goal.past.marks.map((reached, index) => (
          <span key={index} className={`size-3.5 rounded-[3px] ${reached ? "bg-accent" : "border border-control"}`} />
        ))}
      </span>
      <span>
        reached {goal.past.reached} of {goal.past.total}
      </span>
    </p>
  );
}

function Row({ goal, recorderOn, onChanged }: { goal: GoalView; recorderOn: boolean; onChanged: (message: string | null) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(goal.target));
  const [pending, startTransition] = useTransition();
  const parsed = parseTarget(text);

  function run(work: () => ReturnType<typeof setWeeklyGoalTargetAction>, done: () => void) {
    onChanged(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.success) return onChanged(result.error.message);
        done();
        router.refresh();
      } catch {
        onChanged("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 border-t border-border-subtle py-4 first:border-t-0 first:pt-0">
      <GoalBar label={goal.label} progress={goal.progress} />
      <Past goal={goal} />
      {needsRecorder(goal.measure) && !recorderOn && <RecorderNote />}
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (parsed !== null) run(() => setWeeklyGoalTargetAction(goal.id, parsed), () => setEditing(false));
          }}
        >
          <label className="text-sm font-semibold text-text" htmlFor={`target-${goal.id}`}>
            Target
          </label>
          <input
            id={`target-${goal.id}`}
            inputMode="numeric"
            value={text}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={parsed === null}
            className="min-h-11 w-24 rounded-lg border border-control bg-surface px-3 text-[15px] text-text"
          />
          <button type="submit" disabled={pending || parsed === null || parsed === goal.target} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>
            Save
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setText(String(goal.target));
            }}
            className={`${BUTTON} text-text-muted hover:bg-surface-subtle`}
          >
            Cancel
          </button>
          {parsed === null && <span className="text-xs text-danger">A whole number from 1 to {MAX_TARGET}.</span>}
        </form>
      ) : (
        <div className="flex flex-wrap gap-1">
          <button type="button" disabled={pending} onClick={() => setEditing(true)} className={`${BUTTON} -ml-3 text-accent-ink hover:bg-surface-subtle`}>
            Change target
          </button>
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove the goal ${goal.label}`}
            onClick={() => run(() => removeWeeklyGoalAction(goal.id), () => undefined)}
            className={`${BUTTON} text-text-muted hover:bg-surface-subtle`}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

function AddForm({ available, recorderOn, onChanged, onDone }: { available: GoalMeasure[]; recorderOn: boolean; onChanged: (message: string | null) => void; onDone: () => void }) {
  const router = useRouter();
  const [measure, setMeasure] = useState<GoalMeasure>(available[0]);
  const [text, setText] = useState(String(DEFAULT_TARGET[available[0]]));
  const [pending, startTransition] = useTransition();
  const parsed = parseTarget(text);

  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-surface-subtle p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed === null) return;
        onChanged(null);
        startTransition(async () => {
          try {
            const result = await addWeeklyGoalAction({ measure, target: parsed });
            if (!result.success) return onChanged(result.error.message);
            onDone();
            router.refresh();
          } catch {
            onChanged("Could not reach the server. Try again.");
          }
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <label htmlFor="goal-measure" className="text-sm font-semibold text-text">
            What to count
          </label>
          <select
            id="goal-measure"
            value={measure}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value as GoalMeasure;
              setMeasure(next);
              setText(String(DEFAULT_TARGET[next]));
            }}
            className="min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-[15px] text-text"
          >
            {available.map((option) => (
              <option key={option} value={option}>
                {MEASURE_NAME[option]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <label htmlFor="goal-target" className="text-sm font-semibold text-text">
            Each week
          </label>
          <input
            id="goal-target"
            inputMode="numeric"
            value={text}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={parsed === null}
            className="min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-[15px] text-text"
          />
        </div>
        <button type="submit" disabled={pending || parsed === null} className={`${BUTTON} bg-accent px-5 text-on-accent hover:bg-accent-hover`}>
          {pending ? "Adding…" : "Add goal"}
        </button>
        <button type="button" disabled={pending} onClick={onDone} className={`${BUTTON} text-text-muted hover:bg-surface`}>
          Cancel
        </button>
      </div>
      <p className="text-sm text-text">
        {parsed === null ? `A whole number from 1 to ${MAX_TARGET}.` : `${goalLabel(measure, parsed)} every week, Monday to Sunday.`}
      </p>
      {needsRecorder(measure) && !recorderOn && <RecorderNote />}
    </form>
  );
}

/** The weekly goals on the Stats page: what each one needs this week, the eight weeks before it, and the controls to add, change or remove one. */
export function WeeklyGoals({ overview }: { overview: WeeklyGoalsOverview }) {
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { goals, available, recorderOn } = overview;

  return (
    <section id="weekly-goals" aria-labelledby="weekly-goals-title" className="rounded-xl border border-border-subtle bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="weekly-goals-title" className="text-[17px] font-semibold text-text">
            Weekly goals
          </h2>
          <p className="mt-0.5 text-[13px] text-text-muted">This week: {overview.week}. Counted from what the app records.</p>
        </div>
        {available.length > 0 && !adding && (
          <button type="button" onClick={() => setAdding(true)} className={`${BUTTON} border border-control bg-surface text-text hover:bg-surface-subtle`}>
            Add a goal
          </button>
        )}
      </div>

      {adding && available.length > 0 && (
        <div className="mb-4">
          <AddForm available={available} recorderOn={recorderOn} onChanged={setMessage} onDone={() => setAdding(false)} />
        </div>
      )}

      {message && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {message}
        </p>
      )}

      {goals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-sm text-text-muted">
          No weekly goals yet. A small target, such as “3 study sessions”, shows here with how far you are this week.
        </p>
      ) : (
        <ul className="flex flex-col">
          {goals.map((goal) => (
            <Row key={`${goal.id}-${goal.target}`} goal={goal} recorderOn={recorderOn} onChanged={setMessage} />
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-border-subtle pt-3 text-xs text-text-muted">
        Study sessions are the timer sessions you remember (switch on in Focus). Nothing is announced when you reach a goal or miss one, and a changed
        target changes how past weeks read.
      </p>
    </section>
  );
}
