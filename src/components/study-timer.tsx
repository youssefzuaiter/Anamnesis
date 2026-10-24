"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A plain countdown for working on one task.
 *
 * Deliberately writes nothing. `FocusTelemetry` is defined narrowly as writing
 * activity — how long writing was active and how many characters were typed —
 * and a timer running while you read a textbook is neither. Recording sitting
 * time as if it were typing would quietly make the focus figures mean something
 * other than what they claim.
 */

const PRESETS = [25, 50, 15] as const;

function format(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function StudyTimer({ taskTitle }: { taskTitle: string }) {
  const [minutes, setMinutes] = useState<number>(PRESETS[0]);
  const [remaining, setRemaining] = useState<number>(PRESETS[0] * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;

    // Anchored to a wall-clock deadline rather than counting ticks: an
    // interval in a backgrounded tab is throttled, and a tick-counter would
    // drift by minutes over a study session.
    deadlineRef.current = Date.now() + remaining * 1000;

    const id = setInterval(() => {
      const left = Math.max(
        0,
        Math.round(((deadlineRef.current ?? Date.now()) - Date.now()) / 1000),
      );
      setRemaining(left);

      if (left === 0) {
        setRunning(false);
        setFinished(true);
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification("Time's up", { body: taskTitle });
        }
      }
    }, 250);

    return () => clearInterval(id);
    // `remaining` is read once to set the deadline; re-running on every tick
    // would reset it continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, taskTitle]);

  function reset(nextMinutes: number) {
    setMinutes(nextMinutes);
    setRemaining(nextMinutes * 60);
    setRunning(false);
    setFinished(false);
  }

  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-2xl tabular-nums text-text">
          {format(remaining)}
        </span>

        <button
          type="button"
          onClick={() => {
            if (!running && remaining === 0) reset(minutes);
            if (
              !running &&
              typeof Notification !== "undefined" &&
              Notification.permission === "default"
            ) {
              // Asked on the click, never on mount — a page that demands
              // notification permission on load is the thing everyone blocks.
              void Notification.requestPermission();
            }
            setRunning((value) => !value);
            setFinished(false);
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          {running ? "Pause" : remaining === minutes * 60 ? "Start" : "Resume"}
        </button>

        <button
          type="button"
          onClick={() => reset(minutes)}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm text-text transition-colors hover:bg-surface-subtle"
        >
          Reset
        </button>

        <div className="ml-auto flex gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => reset(preset)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                minutes === preset
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border-subtle text-text-muted hover:bg-surface-subtle"
              }`}
            >
              {preset}m
            </button>
          ))}
        </div>
      </div>

      {finished && (
        <p role="status" className="mt-2 text-sm text-text">
          Done — that&apos;s {minutes} minutes on this task. Take a break.
        </p>
      )}

      <p className="mt-2 text-xs text-text-muted">
        Nothing is recorded; this is just a clock.
      </p>
    </section>
  );
}
