"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dueRemindersAction, type Reminder } from "@/actions/reminders";
import { TASKS_CHANGED_EVENT } from "@/lib/domain";

const POLL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "nexus:notified-reminders";

// Notification.permission is a browser value the server cannot know, and it
// changes only when the user answers the prompt. A tiny store gives a
// render-time snapshot without a setState-in-effect cascade — the same shape
// command-palette-trigger.tsx uses for navigator.platform.
const permissionListeners = new Set<() => void>();

function subscribeToPermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  return () => permissionListeners.delete(listener);
}

function readPermission(): boolean {
  return (
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
}

function permissionChanged(): void {
  for (const listener of permissionListeners) listener();
}

/**
 * Surfaces what is imminent, and optionally raises a browser notification for
 * anything not already announced.
 *
 * Which reminders have fired is kept in localStorage rather than on the
 * server: it is per-device state about this browser's notifications, not
 * something another device should inherit. Notification permission is asked
 * for on a click, never on mount.
 */
export function Reminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const announced = useRef<Set<string>>(new Set());

  const enabled = useSyncExternalStore(
    subscribeToPermission,
    readPermission,
    () => false,
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) announced.current = new Set(JSON.parse(stored));
    } catch {
      // A blocked or cleared store just means everything is announced once more.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const result = await dueRemindersAction();
      if (cancelled || !result.success) return;

      setReminders(result.data);

      if (
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      ) {
        return;
      }

      const fresh = result.data.filter(
        (reminder) => !announced.current.has(reminder.id),
      );
      for (const reminder of fresh) {
        new Notification(
          reminder.kind === "task" ? "Due today" : "Starting soon",
          { body: reminder.title, tag: reminder.id },
        );
        announced.current.add(reminder.id);
      }
      if (fresh.length > 0) {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([...announced.current].slice(-200)),
          );
        } catch {
          // Not being able to remember just risks a repeat notification.
        }
      }
    }

    void poll();
    const id = setInterval(poll, POLL_MS);
    // Something moved tasks about (Shut down day): look again now, not in five minutes.
    const onTasksChanged = () => void poll();
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    };
  }, []);

  if (reminders.length === 0) return null;

  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text">
          Due now · {reminders.length}
        </h2>
        {!enabled && (
          <button
            type="button"
            onClick={async () => {
              if (typeof Notification === "undefined") return;
              await Notification.requestPermission();
              permissionChanged();
            }}
            className="text-xs text-accent hover:underline"
          >
            Notify me in the browser
          </button>
        )}
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {reminders.slice(0, 6).map((reminder) => (
          <li key={reminder.id} className="flex items-center gap-2 text-sm">
            <span className="text-xs text-text-faint">
              {reminder.kind === "task" ? "due" : "at"}
            </span>
            <span className="min-w-0 flex-1 truncate text-text">
              {reminder.title}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {new Date(reminder.at).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
