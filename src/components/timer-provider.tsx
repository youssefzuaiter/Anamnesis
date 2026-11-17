"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApiResponse } from "@/lib/api-response";
import type { TimerSnapshot } from "@/services/focus-timer-service";
import {
  pauseTimerAction,
  resetTimerAction,
  resumeTimerAction,
  skipBreakAction,
  skipToBreakAction,
  startBreakAction,
  startNextFocusAction,
  startTimerAction,
  stopTimerAction,
} from "@/actions/focus-timer";

/**
 * The focus timer for every page of the app (ROADMAP item 40). The timer itself is on the server; this holds its latest snapshot, counts down
 * from the server's end time (corrected for this browser's clock) and asks the server again when it runs out, when the tab comes back, and
 * every half minute, so two tabs or a phone agree. It lives in the layout, so it survives moving between pages.
 */

const POLL_MS = 30_000;

type Result = ApiResponse<TimerSnapshot | null>;

export type TimerApi = {
  /** Null until the first answer, and when there is no timer. */
  snapshot: TimerSnapshot | null;
  loaded: boolean;
  /** Seconds left on the clock, counted down here between answers. */
  left: number;
  pending: boolean;
  error: string | null;
  start(input: { taskId: string; minutes: number; notify: boolean }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>;
  skipToBreak(): Promise<void>;
  startBreak(): Promise<void>;
  skipBreak(): Promise<void>;
  startNextFocus(): Promise<void>;
  stop(): Promise<void>;
};

const TimerContext = createContext<TimerApi | null>(null);

export function useTimer(): TimerApi {
  const value = useContext(TimerContext);
  if (!value) throw new Error("useTimer needs a TimerProvider above it.");
  return value;
}

export const clock = (totalSeconds: number): string => `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;

/** Seconds left at `now` (this browser's clock) given how far it is from the server's. Pure, so it can be read while rendering. */
/** Looks at the timer with a GET (not a server action, which would be a POST on every page load and every poll). */
async function fetchTimer(): Promise<Result> {
  const response = await fetch("/api/focus-timer", { cache: "no-store", credentials: "same-origin" });
  return (await response.json()) as Result;
}

function secondsLeft(snapshot: TimerSnapshot | null, skew: number, now: number): number {
  if (!snapshot) return 0;
  if (snapshot.view.status === "running" && snapshot.endsAt) {
    return Math.max(0, Math.ceil((Date.parse(snapshot.endsAt) - (now + skew)) / 1000));
  }
  return snapshot.view.remaining;
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const skewRef = useRef(0);
  const busy = useRef(false);
  const previous = useRef<TimerSnapshot | null>(null);
  const syncedFor = useRef<string | null>(null);

  const receive = useCallback((result: Result) => {
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setError(null);
    const next = result.data;
    if (next) {
      skewRef.current = Date.parse(next.serverNow) - Date.now();
      setSkew(skewRef.current);
      setNow(Date.now());
    }
    // A phase that ran out while this tab was open: say so in the browser's own notification too (asked for on Start, never on load).
    const before = previous.current;
    if (before && next && before.view.status === "running" && next.view.status === "done" && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(next.view.phase === "focus" ? "Time's up" : "Break over", { body: next.taskTitle ?? "Focus timer" });
    }
    previous.current = next;
    setSnapshot(next);
    setLoaded(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      receive(await fetchTimer());
    } catch {
      /* offline: the next poll tries again */
    }
  }, [receive]);

  const exec = useCallback(
    async (call: () => Promise<Result>) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      try {
        receive(await call());
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [receive],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchTimer().then(
      (result) => {
        if (!cancelled) receive(result);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [receive]);

  // The clock: once a second while running; and when it reaches zero, ask the server to finish the phase (once per end time).
  const running = snapshot?.view.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setNow(Date.now());
      const current = previous.current;
      if (current?.endsAt && secondsLeft(current, skewRef.current, Date.now()) === 0 && syncedFor.current !== current.endsAt) {
        syncedFor.current = current.endsAt;
        void refresh();
      }
    }, 500);
    return () => clearInterval(id);
  }, [running, refresh]);

  // Another tab or the server's own timeout may have changed it: look again every half minute while there is one, and when the tab returns.
  const exists = snapshot !== null;
  useEffect(() => {
    if (!exists) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [exists, refresh]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [refresh]);

  const api = useMemo<TimerApi>(
    () => ({
      snapshot,
      loaded,
      left: secondsLeft(snapshot, skew, now),
      pending,
      error,
      start: async (input) => {
        // Asked on the click, never on load: a page that demands notification permission on arrival is the thing everyone blocks.
        if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
        await exec(() => startTimerAction(input));
      },
      pause: () => exec(() => pauseTimerAction()),
      resume: () => exec(() => resumeTimerAction()),
      reset: () => exec(() => resetTimerAction()),
      skipToBreak: () => exec(() => skipToBreakAction()),
      startBreak: () => exec(() => startBreakAction()),
      skipBreak: () => exec(() => skipBreakAction()),
      startNextFocus: () => exec(() => startNextFocusAction()),
      stop: () => exec(() => stopTimerAction()),
    }),
    [snapshot, loaded, pending, error, exec, skew, now],
  );

  return <TimerContext.Provider value={api}>{children}</TimerContext.Provider>;
}
