"use client";

import Link from "next/link";
import { useState } from "react";
import { FOCUS_CHOICES, ROUND_LENGTH } from "@/lib/focus-timer";
import { MIN_SESSION_SECONDS } from "@/lib/focus";
import { clock, useTimer } from "@/components/timer-provider";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const primary = `${button} bg-accent text-on-accent hover:bg-accent-hover`;
const quiet = `${button} border border-control text-text hover:bg-surface-subtle`;

const NOTIFY_KEY = "anamnesis-timer-notify";
function storedNotify(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) !== "off";
  } catch {
    return true;
  }
}

function Dots({ session, status, phase }: { session: number; status: string; phase: string }) {
  // Sessions before this one are done; this one is done only once it has finished; a break sits after its session.
  const doneThrough = phase === "focus" ? (status === "done" ? session : session - 1) : session;
  return (
    <ol aria-label="Sessions in this round" className="flex flex-wrap gap-x-3 gap-y-1">
      {Array.from({ length: ROUND_LENGTH }, (_, index) => {
        const number = index + 1;
        const isDone = number <= doneThrough;
        const isNow = phase === "focus" && number === session && status !== "done";
        return (
          <li key={number} className={`flex items-center gap-1.5 text-xs ${isNow ? "font-semibold text-text" : "text-text-muted"}`}>
            <span
              aria-hidden="true"
              className={`size-3.5 rounded-full ${isDone ? "bg-accent" : isNow ? "border-[3px] border-accent" : "border-2 border-control"}`}
            />
            {number}
            {isDone ? " done" : isNow ? " now" : ""}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The timer on a task's page (ROADMAP item 40). It shows and drives the one timer of the account, which keeps running on the server while the
 * person uses the rest of the app (the chip in the header is the same timer). Study time is saved by the server, never sent from here.
 */
export function FocusTimerCard({
  taskId,
  taskTitle,
  remember,
  phoneAvailable,
}: {
  taskId: string;
  taskTitle: string;
  remember: { enabled: boolean; courseCode: string | null };
  phoneAvailable: boolean;
}) {
  const timer = useTimer();
  const { snapshot, left, pending, error } = timer;
  const [minutes, setMinutes] = useState<number>(FOCUS_CHOICES[0]);
  const [notify, setNotify] = useState<boolean>(storedNotify);
  const mine = snapshot !== null && snapshot.taskId === taskId;
  const elsewhere = snapshot !== null && !mine;

  const rememberLine = remember.enabled ? (
    <>
      {remember.courseCode ? (
        <>
          Remembered under <span className="font-mono text-accent-ink">{remember.courseCode}</span>
        </>
      ) : (
        "Remembered, with no course,"
      )}{" "}
      when each focus session ends, when you reset it or skip to a break, or when you stop. Only how long it ran is kept, never a break.
    </>
  ) : (
    <>
      Not remembered. This is just a clock. To keep timer time under its course, turn on “Remember timer sessions” on the{" "}
      <Link href="/focus" className="text-accent hover:underline">
        Focus page
      </Link>
      .
    </>
  );

  const phoneToggle = phoneAvailable && (
    <label className="flex min-h-11 items-center justify-between gap-3 border-t border-border-subtle pt-3 text-sm text-text">
      <span>Ring my phone when it ends</span>
      <input
        type="checkbox"
        role="switch"
        checked={notify}
        disabled={mine && snapshot?.view.status !== "ready"}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          setNotify(next);
          try {
            localStorage.setItem(NOTIFY_KEY, next ? "on" : "off");
          } catch {
            /* storage blocked: the choice lasts for this page view */
          }
        }}
        className="size-5 accent-accent"
      />
    </label>
  );

  function body() {
    if (!snapshot || elsewhere) {
      return (
        <>
          {elsewhere && (
            <p className="text-sm text-text-muted">
              A timer is running on{" "}
              {snapshot.taskTitle && snapshot.taskId ? (
                <Link href={`/tasks/${snapshot.taskId}`} className="font-medium text-accent hover:underline">
                  {snapshot.taskTitle}
                </Link>
              ) : (
                "another task"
              )}
              . Starting here saves what it has run and replaces it.
            </p>
          )}
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-4xl font-bold tabular-nums text-text">{clock(minutes * 60)}</span>
            <div role="group" aria-label="Focus length" className="flex gap-1">
              {FOCUS_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={minutes === choice}
                  onClick={() => setMinutes(choice)}
                  className={`min-h-9 rounded-full border px-3 text-xs transition-colors ${
                    minutes === choice ? "border-accent bg-accent-soft text-accent" : "border-border-subtle text-text-muted hover:bg-surface-subtle"
                  }`}
                >
                  {choice}m
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => void timer.start({ taskId, minutes, notify: phoneAvailable && notify })} className={primary}>
              {elsewhere ? "Start here instead" : "Start"}
            </button>
          </div>
        </>
      );
    }

    const { view } = snapshot;
    const isFocus = view.phase === "focus";
    const label = isFocus ? "Focus" : view.phase === "long_break" ? "Long break" : "Break";

    if (view.status === "done") {
      const savedMinutes = Math.round(snapshot.savedSeconds / 60);
      const next = view.next;
      return (
        <>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-4xl font-bold tabular-nums text-text">0:00</span>
            <span className="text-sm font-semibold text-ok">{isFocus ? `Session ${view.session} of ${view.roundLength} done` : `${label} over`}</span>
          </div>
          <Dots session={view.session} status={view.status} phase={view.phase} />
          <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-text">
            {isFocus
              ? snapshot.savedSeconds >= MIN_SESSION_SECONDS && remember.enabled
                ? `Saved ${savedMinutes} min${remember.courseCode ? ` under ${remember.courseCode}` : ""}.`
                : "Done. Not saved: this is just a clock."
              : `Focus session ${(view.completedFocus % view.roundLength) + 1} of ${view.roundLength} is ready when you are.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {isFocus ? (
              <>
                <button type="button" disabled={pending} onClick={() => void timer.startBreak()} className={primary}>
                  Start the {next === "long_break" ? 15 : 5} min break
                </button>
                <button type="button" disabled={pending} onClick={() => void timer.skipBreak()} className={quiet}>
                  Skip the break
                </button>
              </>
            ) : (
              <button type="button" disabled={pending} onClick={() => void timer.startNextFocus()} className={primary}>
                Start the next focus session
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => void timer.stop()} className={quiet}>
              Stop the round
            </button>
          </div>
          <p className="text-xs text-text-muted">Nothing starts by itself: you choose each next step.</p>
        </>
      );
    }

    const running = view.status === "running";
    return (
      <>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-4xl font-bold tabular-nums text-text">{clock(left)}</span>
          <span className={`text-sm font-semibold ${isFocus ? "text-accent-ink" : "text-warn"}`}>
            {isFocus ? `Focus · session ${view.session} of ${view.roundLength}` : label}
          </span>
        </div>
        {isFocus ? (
          <Dots session={view.session} status={view.status} phase={view.phase} />
        ) : (
          <p className="text-sm text-text-muted">
            Next: focus session {view.phase === "long_break" ? 1 : view.session} of {view.roundLength}. A break is not recorded as study time.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => void (running ? timer.pause() : timer.resume())} className={primary}>
            {running ? "Pause" : view.status === "ready" ? "Start" : "Resume"}
          </button>
          {isFocus ? (
            <>
              {view.status !== "ready" && (
                <button type="button" disabled={pending} onClick={() => void timer.reset()} className={quiet}>
                  Reset
                </button>
              )}
              {view.status !== "ready" && (
                <button type="button" disabled={pending} onClick={() => void timer.skipToBreak()} className={quiet}>
                  Skip to break
                </button>
              )}
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => void timer.skipBreak()} className={quiet}>
              Skip break
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => void timer.stop()} className={quiet}>
            Stop the round
          </button>
        </div>
      </>
    );
  }

  return (
    <section aria-label="Study timer" className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <div>
        <h2 className="text-[15px] font-bold text-text">Focus timer</h2>
        <p className="text-[13px] text-text-muted">{taskTitle}</p>
      </div>
      {body()}
      {error && (
        <p role="group" aria-label="Timer problem" aria-live="assertive" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {phoneToggle}
      <p className="text-xs text-text-muted">
        Keeps running while you use the rest of the app. {rememberLine}
      </p>
    </section>
  );
}
