import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BREAK_MINUTES,
  FOCUS_CHOICES,
  LONG_BREAK_MINUTES,
  ROUND_LENGTH,
  breakKind,
  due,
  finalize,
  pause,
  remaining,
  resume,
  skipBreak,
  skipToBreak,
  startBreak,
  startFocus,
  startNextFocus,
  statusOf,
  unsaved,
  view,
  type TimerState,
} from "@/lib/focus-timer";

const T0 = new Date("2026-11-16T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const focus = (extra: Partial<Parameters<typeof startFocus>[0]> = {}) =>
  startFocus({ taskId: "task-1", minutes: 25, notify: true, completedFocus: 0, ...extra }, T0);

test("the choices and lengths are the ones in the design", () => {
  assert.deepEqual([...FOCUS_CHOICES], [25, 50, 15]);
  assert.equal(BREAK_MINUTES, 5);
  assert.equal(LONG_BREAK_MINUTES, 15);
  assert.equal(ROUND_LENGTH, 4);
});

test("a focus session starts running, with its end fixed in time", () => {
  const state = focus();
  assert.equal(statusOf(state), "running");
  assert.equal(state.phase, "focus");
  assert.equal(state.phaseSeconds, 1500);
  assert.equal(state.endsAt?.getTime(), at(1500).getTime());
  assert.equal(state.pausedRemaining, null);
  assert.equal(state.finishedAt, null);
  assert.equal(remaining(state, T0), 1500);
  assert.equal(remaining(state, at(60)), 1440);
  assert.equal(remaining(state, at(1500)), 0);
  assert.equal(remaining(state, at(9999)), 0, "never negative");
  assert.equal(due(state, at(1499)), false);
  assert.equal(due(state, at(1500)), true);
});

test("pausing keeps what is left, resuming puts the end that far from now, and time spent paused is not counted", () => {
  const paused = pause(focus(), at(600));
  assert.equal(statusOf(paused), "paused");
  assert.equal(paused.pausedRemaining, 900);
  assert.equal(paused.endsAt, null);
  assert.equal(remaining(paused, at(5000)), 900, "a paused timer does not move");
  const resumed = resume(paused, at(5000));
  assert.equal(statusOf(resumed), "running");
  assert.equal(resumed.endsAt?.getTime(), at(5900).getTime());
  assert.throws(() => pause(paused, at(700)), /running/);
  assert.throws(() => resume(resumed, at(5001)), /paused/);
});

test("a timer that was never started is ready, and one that has run is paused", () => {
  const done = finalize(focus(), at(1500));
  const ready = skipBreak(done);
  assert.equal(statusOf(ready), "ready");
  assert.equal(ready.pausedRemaining, 1500);
  assert.equal(statusOf(pause(focus(), at(10))), "paused");
  assert.equal(statusOf(pause(focus(), T0)), "ready", "paused at the very start is the same as not started");
});

test("a session that runs out is done, and counts as a completed one", () => {
  const state = focus();
  assert.throws(() => finalize(state, at(1499)), /not due/);
  const done = finalize(state, at(1503));
  assert.equal(statusOf(done), "done");
  assert.equal(done.completedFocus, 1);
  assert.equal(done.finishedAt?.getTime(), at(1500).getTime(), "finished when it ran out, not when it was noticed");
  assert.equal(done.endsAt, null);
  assert.equal(remaining(done, at(99999)), 0);
});

test("study time is only a focus session's, and only what has not been saved yet", () => {
  const state = focus();
  assert.equal(unsaved(state, at(600)), 600);
  assert.equal(unsaved({ ...state, savedSeconds: 600 }, at(600)), 0);
  assert.equal(unsaved({ ...state, savedSeconds: 600 }, at(900)), 300);
  assert.equal(unsaved(pause(state, at(600)), at(9000)), 600, "paused time is not study time");
  assert.equal(unsaved(finalize(state, at(1500)), at(1500)), 1500);
  assert.equal(unsaved(finalize(state, at(1500)), at(9000)), 1500, "a finished session is its whole length, however late it is read");
  const brk = startBreak(finalize(state, at(1500)), at(1500));
  assert.equal(unsaved(brk, at(1700)), 0, "a break is never study time");
});

test("after a focus session comes a break, a long one after the fourth, and the round starts over after that", () => {
  assert.equal(breakKind(0), "break", "no session finished yet is never a long break");
  assert.equal(breakKind(1), "break");
  assert.equal(breakKind(3), "break");
  assert.equal(breakKind(4), "long_break");
  assert.equal(breakKind(5), "break");
  assert.equal(breakKind(8), "long_break");

  let state = focus();
  for (let session = 1; session <= 3; session++) {
    state = finalize(state, state.endsAt!);
    assert.equal(state.completedFocus, session);
    const brk = startBreak(state, state.finishedAt!);
    assert.equal(brk.phase, "break");
    assert.equal(brk.phaseSeconds, 300);
    assert.equal(statusOf(brk), "running");
    state = startNextFocus(finalize(brk, brk.endsAt!), brk.endsAt!);
    assert.equal(state.phase, "focus");
    assert.equal(state.completedFocus, session, "the count carries on");
    assert.equal(statusOf(state), "running");
    assert.equal(state.savedSeconds, 0);
  }
  state = finalize(state, state.endsAt!);
  assert.equal(state.completedFocus, 4);
  const long = startBreak(state, state.finishedAt!);
  assert.equal(long.phase, "long_break");
  assert.equal(long.phaseSeconds, 900);
  const after = startNextFocus(finalize(long, long.endsAt!), long.endsAt!);
  assert.equal(after.completedFocus, 0, "the round starts over after the long break");
});

test("skipping to a break ends the focus session now and counts it; a session that never started cannot be skipped", () => {
  const skipped = skipToBreak(focus(), at(400));
  assert.equal(skipped.phase, "break");
  assert.equal(skipped.completedFocus, 1);
  assert.equal(statusOf(skipped), "running");
  assert.equal(skipped.endsAt?.getTime(), at(400 + 300).getTime());
  const fromPaused = skipToBreak(pause(focus(), at(100)), at(900));
  assert.equal(fromPaused.phase, "break");
  const ready = skipBreak(finalize(focus(), at(1500)));
  assert.throws(() => skipToBreak(ready, at(5)), /nothing to skip|ready/i);
  assert.throws(() => skipToBreak(skipped, at(500)), /focus/);
});

test("skipping a break goes back to a focus session that waits to be started, and a skipped long break starts the round over", () => {
  const brk = startBreak(finalize(focus(), at(1500)), at(1500));
  const ready = skipBreak(brk);
  assert.equal(ready.phase, "focus");
  assert.equal(statusOf(ready), "ready");
  assert.equal(ready.completedFocus, 1);
  assert.equal(ready.phaseSeconds, 1500);

  const four = focus({ completedFocus: 3 });
  const fourDone = finalize(four, four.endsAt!);
  assert.equal(skipBreak(fourDone).completedFocus, 0, "skipping the break after the fourth session also ends the round");
  assert.equal(skipBreak(startBreak(fourDone, fourDone.finishedAt!)).completedFocus, 0);
});

test("the view says what to show: the status, the time, which session of four, and what is next", () => {
  const state = focus({ completedFocus: 1 });
  const running = view(state, at(120));
  assert.deepEqual(
    { status: running.status, phase: running.phase, remaining: running.remaining, session: running.session, of: running.roundLength },
    { status: "running", phase: "focus", remaining: 1380, session: 2, of: 4 },
  );
  const done = view(finalize(state, at(1500)), at(2000));
  assert.deepEqual({ status: done.status, session: done.session, remaining: done.remaining, next: done.next }, { status: "done", session: 2, remaining: 0, next: "break" });
  const longDone = view(finalize(focus({ completedFocus: 3 }), at(1500)), at(1500));
  assert.equal(longDone.next, "long_break");
  const brkDone = view(finalize(startBreak(finalize(state, at(1500)), at(1500)), at(1800)), at(1800));
  assert.deepEqual({ status: brkDone.status, phase: brkDone.phase, next: brkDone.next, session: brkDone.session }, { status: "done", phase: "break", next: "focus", session: 3 });
});

test("a state that is not exactly one of running, paused and finished is refused", () => {
  const good = focus();
  const bad: TimerState[] = [
    { ...good, pausedRemaining: 10 },
    { ...good, endsAt: null },
    { ...good, finishedAt: T0 },
  ];
  for (const state of bad) assert.throws(() => statusOf(state), /exactly one/i);
});
