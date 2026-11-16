"use client";

import Link from "next/link";
import { clock, useTimer } from "@/components/timer-provider";

const PHASE = { focus: "Focus", break: "Break", long_break: "Long break" } as const;

/**
 * The timer in the header of every page while one is running, paused or waiting for the next step (ROADMAP item 40). It is the same timer as
 * on the task page: pausing here pauses there. Nothing is announced every second; a short polite message says when a phase changes.
 */
export function TimerChip() {
  const { snapshot, left, pending, pause, resume } = useTimer();
  if (!snapshot || snapshot.view.status === "ready") return null;
  const { view } = snapshot;
  const done = view.status === "done";
  const label = done ? (view.phase === "focus" ? "Focus done" : "Break over") : PHASE[view.phase];
  const href = snapshot.taskId && snapshot.taskTitle ? `/tasks/${snapshot.taskId}` : "/focus";

  return (
    <div
      role="group"
      aria-label="Timer in progress"
      className="flex min-h-11 min-w-0 items-center gap-2 rounded-full border border-control bg-surface py-1 pl-3.5 pr-1.5 text-sm text-text"
    >
      {!done && <span className="font-mono text-[15px] font-bold tabular-nums">{clock(left)}</span>}
      <Link href={href} className="min-w-0 max-w-[10rem] truncate text-[13px] text-text-muted hover:text-text sm:max-w-[14rem]">
        {label}
        {snapshot.taskTitle ? ` · ${snapshot.taskTitle}` : ""}
      </Link>
      {done ? (
        <Link href={href} className="inline-flex min-h-9 items-center rounded-full bg-accent px-3.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover">
          Open
        </Link>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => void (view.status === "running" ? pause() : resume())}
          className="inline-flex min-h-9 items-center rounded-full bg-accent px-3.5 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {view.status === "running" ? "Pause" : "Resume"}
        </button>
      )}
      <span aria-live="polite" className="sr-only">
        {done ? `${label}.` : ""}
      </span>
    </div>
  );
}
