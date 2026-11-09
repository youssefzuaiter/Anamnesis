"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { recordTimerSessionAction } from "@/actions/focus";
import { MIN_SESSION_SECONDS } from "@/lib/focus";
import { unsavedTimerSeconds } from "@/lib/study-time";

/**
 * A countdown for working on one task.
 *
 * It writes nothing unless the person switched "Remember timer sessions" on. When that is on, it keeps
 * one thing: how long the clock ran, under the task's course — not the task, not what was worked on.
 * `FocusTelemetry` stays narrowly writing activity; the timer has its own table so the two kinds of time
 * are never mistaken for each other.
 *
 * Time is saved when the timer finishes, when it is reset (or a different length is chosen), and when the
 * page is left. `savedRef` remembers how much of this run was already saved, so a finish followed by a
 * reset, or a pause followed by a leave, never counts a second twice.
 */

const PRESETS = [25, 50, 15] as const;

function format(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function savedText(seconds: number, courseCode: string | null): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return courseCode ? `Saved ${minutes} min under ${courseCode}.` : `Saved ${minutes} min.`;
}

export function StudyTimer({
  taskId,
  taskTitle,
  remember,
}: {
  taskId: string;
  taskTitle: string;
  remember: { enabled: boolean; courseCode: string | null };
}) {
  const [minutes, setMinutes] = useState<number>(PRESETS[0]);
  const [remaining, setRemaining] = useState<number>(PRESETS[0] * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const deadlineRef = useRef<number | null>(null);

  // What the save needs to know, readable from a timer callback or an unmount without a stale closure.
  const minutesRef = useRef<number>(minutes);
  const remainingRef = useRef<number>(remaining);
  const runningRef = useRef(running);
  const savedSecondsRef = useRef(0);
  const runRef = useRef(0);
  const rememberRef = useRef({ ...remember, taskId });
  useEffect(() => {
    minutesRef.current = minutes;
    remainingRef.current = remaining;
    runningRef.current = running;
    rememberRef.current = { ...remember, taskId };
  });

  function secondsLeft(): number {
    if (runningRef.current && deadlineRef.current !== null) {
      return Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
    }
    return remainingRef.current;
  }

  /**
   * Saves what has run and not yet been saved, if remembering is on and it is long enough to mean
   * anything. The share is claimed before the request, so a second trigger cannot take it again;
   * a failure gives it back, unless the run has been reset since.
   */
  async function saveRun(remainingOverride?: number): Promise<string | null> {
    const current = rememberRef.current;
    if (!current.enabled) return null;

    const unsaved = unsavedTimerSeconds({
      totalSeconds: minutesRef.current * 60,
      remainingSeconds: remainingOverride ?? secondsLeft(),
      savedSeconds: savedSecondsRef.current,
    });
    if (unsaved < MIN_SESSION_SECONDS) return null;

    const run = runRef.current;
    savedSecondsRef.current += unsaved;
    const response = await recordTimerSessionAction({ taskId: current.taskId, seconds: unsaved });
    if (response.success && response.data.saved) {
      return savedText(response.data.seconds, response.data.courseCode);
    }
    if (run === runRef.current) savedSecondsRef.current -= unsaved;
    return null;
  }

  // Leaving the page saves too: the link away from the task unmounts this, a closing tab fires pagehide.
  useEffect(() => {
    const leave = () => {
      void saveRun();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
    // `saveRun` reads everything through refs, so it never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        void saveRun(0).then((text) => setSaved(text));
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
    // What ran is saved first, while the refs still describe that run.
    void saveRun().then((text) => setSaved(text));
    runRef.current += 1;
    savedSecondsRef.current = 0;

    setMinutes(nextMinutes);
    setRemaining(nextMinutes * 60);
    setRunning(false);
    setFinished(false);
  }

  return (
    <section aria-label="Study timer" className="rounded-xl border border-border-subtle bg-surface p-4">
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
            setSaved(null);
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

      {finished ? (
        <p role="status" className="mt-2 text-sm text-text">
          Done — that&apos;s {minutes} minutes on this task.{saved ? ` ${saved}` : ""} Take a break.
        </p>
      ) : (
        saved && (
          <p role="status" className="mt-2 text-sm text-text">
            {saved}
          </p>
        )
      )}

      <p className="mt-2 text-xs text-text-muted">
        {remember.enabled ? (
          <>
            {remember.courseCode ? (
              <>
                Remembered under{" "}
                <span className="font-mono text-accent-ink">{remember.courseCode}</span>
              </>
            ) : (
              "Remembered, with no course,"
            )}{" "}
            when it finishes, when you reset it, or when you leave the page. Only how
            long it ran is kept.
          </>
        ) : (
          <>
            Not remembered. This is just a clock. To keep timer time under its course,
            turn on “Remember timer sessions” on the{" "}
            <Link href="/focus" className="text-accent hover:underline">
              Focus page
            </Link>
            .
          </>
        )}
      </p>
    </section>
  );
}
