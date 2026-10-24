"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setFocusTrackingAction, clearFocusHistoryAction } from "@/actions/focus";

export function FocusSettings({
  enabled,
  hasHistory,
}: {
  enabled: boolean;
  hasHistory: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    // Flip immediately: waiting for the round trip makes the checkbox feel
    // broken. If the write fails the box goes back to what the server holds.
    const next = !on;
    setOn(next);
    setBusy(true);

    const response = await setFocusTrackingAction(next);
    setOn(response.success ? response.data.enabled : !next);
    setBusy(false);
    router.refresh();
  }

  async function clear() {
    if (!confirm("Delete all recorded focus sessions? This cannot be undone.")) return;
    setBusy(true);
    await clearFocusHistoryAction();
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          onChange={toggle}
          disabled={busy}
          aria-label="Record focus sessions"
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">
            Record focus sessions
          </span>
          <span className="mt-0.5 block text-xs text-text-muted">
            While writing a note, Anamnesis measures how long you write for and how
            fast you type. It never records what you write. Off by default, and
            the server stores nothing while this is off.
          </span>
        </span>
      </label>

      {hasHistory && (
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="mt-3 rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60"
        >
          Delete all recorded sessions
        </button>
      )}
    </div>
  );
}
