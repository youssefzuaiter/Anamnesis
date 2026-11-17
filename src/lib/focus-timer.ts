// The focus timer's rules (ROADMAP item 40). Pure: no Prisma and no React, so every rule is tested without a database. The timer lives on
// the server (it keeps running while the person browses, and it can ring a phone), and this file is its state machine: one state, a few
// transitions, and what each shows. A timer is exactly one of RUNNING (it has an end), PAUSED (it has what is left) or FINISHED (it ran out
// and waits for the person to choose the next step). Nothing ever starts by itself.

import { unsavedTimerSeconds } from "@/lib/study-time";

export const FOCUS_CHOICES = [25, 50, 15] as const;
export const BREAK_MINUTES = 5;
export const LONG_BREAK_MINUTES = 15;
/** Focus sessions in one round: after this many comes a long break, and the count starts over. */
export const ROUND_LENGTH = 4;

export type Phase = "focus" | "break" | "long_break";

export type TimerState = {
  taskId: string | null;
  phase: Phase;
  /** The focus length chosen, kept through breaks so the next session is the same length. */
  focusMinutes: number;
  /** The length of this phase. */
  phaseSeconds: number;
  /** Set while running: the moment the phase runs out. */
  endsAt: Date | null;
  /** Set while paused (or not yet started): what is left. */
  pausedRemaining: number | null;
  /** Set when the phase ran out: when it did. */
  finishedAt: Date | null;
  /** Focus sessions completed in this round so far. */
  completedFocus: number;
  /** Of this focus phase, how many seconds were already written as study time. */
  savedSeconds: number;
  notifyPhone: boolean;
};

export type Status = "running" | "paused" | "ready" | "done";

/** Which of the three states the timer is in; a state that is not exactly one of them is a bug, never data. */
export function statusOf(state: TimerState): Status {
  const set = [state.endsAt !== null, state.pausedRemaining !== null, state.finishedAt !== null].filter(Boolean).length;
  if (set !== 1) throw new Error("A timer is exactly one of running, paused or finished.");
  if (state.finishedAt !== null) return "done";
  if (state.endsAt !== null) return "running";
  return state.phase === "focus" && state.pausedRemaining === state.phaseSeconds && state.savedSeconds === 0 ? "ready" : "paused";
}

/** Whether a running timer has reached its end. */
export function due(state: TimerState, now: Date): boolean {
  return state.endsAt !== null && state.endsAt.getTime() <= now.getTime();
}

/** Seconds left, never negative: zero once finished or past its end. */
export function remaining(state: TimerState, now: Date): number {
  if (state.finishedAt !== null) return 0;
  if (state.endsAt !== null) return Math.max(0, Math.ceil((state.endsAt.getTime() - now.getTime()) / 1000));
  return state.pausedRemaining ?? 0;
}

/**
 * Study time not yet saved: a focus phase's elapsed seconds less what was already saved. A break is never study time, and time spent
 * paused is not elapsed (it is the phase length less what is left). A finished session is its whole length however late it is read.
 */
export function unsaved(state: TimerState, now: Date): number {
  if (state.phase !== "focus") return 0;
  return unsavedTimerSeconds({
    totalSeconds: state.phaseSeconds,
    remainingSeconds: remaining(state, now),
    savedSeconds: state.savedSeconds,
  });
}

const seconds = (minutes: number) => minutes * 60;

export function startFocus(input: { taskId: string | null; minutes: number; notify: boolean; completedFocus: number }, now: Date): TimerState {
  const phaseSeconds = seconds(input.minutes);
  return {
    taskId: input.taskId,
    phase: "focus",
    focusMinutes: input.minutes,
    phaseSeconds,
    endsAt: new Date(now.getTime() + phaseSeconds * 1000),
    pausedRemaining: null,
    finishedAt: null,
    completedFocus: input.completedFocus,
    savedSeconds: 0,
    notifyPhone: input.notify,
  };
}

export function pause(state: TimerState, now: Date): TimerState {
  if (statusOf(state) !== "running") throw new Error("Only a running timer can be paused.");
  return { ...state, endsAt: null, pausedRemaining: remaining(state, now) };
}

export function resume(state: TimerState, now: Date): TimerState {
  const status = statusOf(state);
  if (status !== "paused" && status !== "ready") throw new Error("Only a paused timer can be resumed.");
  return { ...state, endsAt: new Date(now.getTime() + (state.pausedRemaining ?? 0) * 1000), pausedRemaining: null };
}

/** A running timer that has reached its end becomes finished (and a focus session counts as completed). */
export function finalize(state: TimerState, now: Date): TimerState {
  if (!due(state, now)) throw new Error("The timer is not due yet.");
  return {
    ...state,
    endsAt: null,
    pausedRemaining: null,
    finishedAt: state.endsAt,
    completedFocus: state.phase === "focus" ? state.completedFocus + 1 : state.completedFocus,
  };
}

/** The break that follows `completedFocus` sessions: a long one after every fourth. */
export function breakKind(completedFocus: number): "break" | "long_break" {
  return completedFocus > 0 && completedFocus % ROUND_LENGTH === 0 ? "long_break" : "break";
}

export function startBreak(state: TimerState, now: Date): TimerState {
  if (state.phase !== "focus") throw new Error("A break follows a focus session.");
  const phase = breakKind(state.completedFocus);
  const phaseSeconds = seconds(phase === "long_break" ? LONG_BREAK_MINUTES : BREAK_MINUTES);
  return {
    ...state,
    phase,
    phaseSeconds,
    endsAt: new Date(now.getTime() + phaseSeconds * 1000),
    pausedRemaining: null,
    finishedAt: null,
    savedSeconds: 0,
  };
}

/** Ends the focus session now, counts it, and starts the break. Nothing to skip before it was started. */
export function skipToBreak(state: TimerState, now: Date): TimerState {
  if (state.phase !== "focus") throw new Error("Only a focus session can be skipped to a break.");
  const status = statusOf(state);
  if (status === "ready") throw new Error("A session that has not started has nothing to skip: it is ready.");
  if (status === "done") return startBreak(state, now);
  return startBreak({ ...state, endsAt: state.endsAt, completedFocus: state.completedFocus + 1 }, now);
}

/** Back to a focus session that waits to be started. After a long break, or a skipped one, the round starts over. */
export function skipBreak(state: TimerState): TimerState {
  const endsRound = state.phase === "long_break" || (state.phase === "focus" && state.finishedAt !== null && breakKind(state.completedFocus) === "long_break");
  const phaseSeconds = seconds(state.focusMinutes);
  return {
    ...state,
    phase: "focus",
    phaseSeconds,
    endsAt: null,
    pausedRemaining: phaseSeconds,
    finishedAt: null,
    savedSeconds: 0,
    completedFocus: endsRound ? 0 : state.completedFocus,
  };
}

/** The next focus session, running, after a break (or from ready). */
export function startNextFocus(state: TimerState, now: Date): TimerState {
  return resume(skipBreak(state), now);
}

export type TimerView = {
  status: Status;
  phase: Phase;
  remaining: number;
  phaseSeconds: number;
  /** Which focus session of the round this is (1 to 4): the one running, or the one just finished. */
  session: number;
  roundLength: number;
  completedFocus: number;
  /** What comes after a finished phase. */
  next: "break" | "long_break" | "focus" | null;
};

/** What to show for a state at a moment. */
export function view(state: TimerState, now: Date): TimerView {
  const status = statusOf(state);
  // The focus session shown: the one running, or the one just finished (a long break follows the last of the round).
  const finishedFocus = state.phase === "focus" && status === "done";
  let session: number;
  if (state.phase === "focus") session = ((finishedFocus ? state.completedFocus - 1 : state.completedFocus) % ROUND_LENGTH) + 1;
  else if (state.phase === "long_break") session = ROUND_LENGTH;
  else session = (state.completedFocus % ROUND_LENGTH) + 1;
  let next: TimerView["next"] = null;
  if (status === "done") next = state.phase === "focus" ? breakKind(state.completedFocus) : "focus";
  return {
    status,
    phase: state.phase,
    remaining: remaining(state, now),
    phaseSeconds: state.phaseSeconds,
    session,
    roundLength: ROUND_LENGTH,
    completedFocus: state.completedFocus,
    next,
  };
}
