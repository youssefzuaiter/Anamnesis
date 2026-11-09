"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiResponse } from "@/lib/api-response";
import {
  setFocusTrackingAction,
  setFocusCourseAction,
  setTimerSessionsAction,
  clearFocusHistoryAction,
} from "@/actions/focus";
import type { FocusSwitches } from "@/services/focus-service";

export function FocusSettings({
  settings,
  hasHistory,
}: {
  settings: FocusSwitches;
  hasHistory: boolean;
}) {
  const router = useRouter();
  const [switches, setSwitches] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function change(
    optimistic: Partial<FocusSwitches>,
    send: (enabled: boolean) => Promise<ApiResponse<FocusSwitches>>,
    enabled: boolean,
  ) {
    // Flip immediately: waiting for the round trip makes the checkbox feel
    // broken. If the write fails the boxes go back to what the server holds.
    const before = switches;
    setSwitches({ ...switches, ...optimistic });
    setBusy(true);
    setProblem(null);

    const response = await send(enabled);
    if (response.success) {
      setSwitches(response.data);
    } else {
      setSwitches(before);
      setProblem(response.error.message);
    }
    setBusy(false);
    router.refresh();
  }

  async function clear() {
    if (!confirm("Delete all recorded writing and timer sessions? This cannot be undone.")) return;
    setBusy(true);
    await clearFocusHistoryAction();
    setBusy(false);
    router.refresh();
  }

  const box = "mt-0.5 size-4 accent-[var(--accent)]";

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={switches.tracking}
          onChange={() =>
            change(
              switches.tracking ? { tracking: false, includeCourse: false } : { tracking: true },
              setFocusTrackingAction,
              !switches.tracking,
            )
          }
          disabled={busy}
          aria-label="Record focus sessions"
          className={box}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">
            Record focus sessions
          </span>
          <span className="mt-0.5 block text-xs text-text-muted">
            While writing a note, Anamnesis measures how long you write for and how
            fast you type. It never records what you write. Off by default, and the
            server stores nothing while this is off.
          </span>
        </span>
      </label>

      <label
        className={`ml-7 mt-3 flex min-h-11 items-start gap-3 ${
          switches.tracking ? "cursor-pointer" : "opacity-65"
        }`}
      >
        <input
          type="checkbox"
          checked={switches.includeCourse}
          onChange={() =>
            change(
              { includeCourse: !switches.includeCourse },
              setFocusCourseAction,
              !switches.includeCourse,
            )
          }
          disabled={busy || !switches.tracking}
          aria-label="Include the course"
          className={box}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">Include the course</span>
          <span className="mt-0.5 block text-xs text-text-muted">
            {switches.tracking
              ? "Also keep which course the note belongs to, so writing time can be shown by course. Never the note’s title or text. Off by default."
              : "Available once “Record focus sessions” is on. Then it also keeps which course the note belongs to, so writing time can be shown by course. Never the note’s title or text."}
          </span>
        </span>
      </label>

      <hr className="my-3.5 border-border-subtle" />

      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={switches.timer}
          onChange={() =>
            change({ timer: !switches.timer }, setTimerSessionsAction, !switches.timer)
          }
          disabled={busy}
          aria-label="Remember timer sessions"
          className={box}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">
            Remember timer sessions
          </span>
          <span className="mt-0.5 block text-xs text-text-muted">
            When you run the timer on a task, Anamnesis keeps how long it ran and
            which course the task belongs to. It never records what you worked on.
            Off by default, and the server stores nothing while this is off.
          </span>
        </span>
      </label>

      {problem && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {problem}
        </p>
      )}

      {hasHistory && (
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="mt-3 min-h-11 rounded-lg px-2.5 text-xs text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60 sm:min-h-8"
        >
          Delete all recorded sessions
        </button>
      )}
    </div>
  );
}
