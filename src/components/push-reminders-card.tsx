"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendTestNotificationAction, setPushSettingsAction } from "@/actions/reminders-push";
import { DIGEST_HOURS, LEAD_CHOICES } from "@/lib/reminder-schedule";
import type { PushSettings } from "@/services/reminder-push-service";

const field =
  "min-h-11 rounded-lg border border-control bg-surface px-2.5 text-sm text-text focus:border-accent focus:outline-none disabled:opacity-60 sm:min-h-9";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-control px-4 text-sm font-medium text-text transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9";

/**
 * Reminders sent to the phone through the self-hosted ntfy server while no tab is open. Every change is
 * saved at once, the way the Focus switches are. The topic is the server's own; the browser never names it.
 */
export function PushRemindersCard({
  configured,
  serverAddress,
  initial,
}: {
  configured: boolean;
  serverAddress: string | null;
  initial: PushSettings;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function save(next: Partial<{ enabled: boolean; leadMinutes: number; digestHour: number; showTitles: boolean }>) {
    const before = settings;
    const wanted = { enabled: settings.enabled, ...settings.prefs, ...next };
    setSettings({ ...settings, enabled: wanted.enabled, prefs: { leadMinutes: wanted.leadMinutes, digestHour: wanted.digestHour, showTitles: wanted.showTitles } });
    setBusy(true);
    setProblem(null);
    setStatus("");
    const response = await setPushSettingsAction(wanted);
    if (response.success) {
      setSettings(response.data);
      setStatus("Saved.");
    } else {
      setSettings(before);
      setProblem(response.error.message);
    }
    setBusy(false);
    router.refresh();
  }

  async function test() {
    setBusy(true);
    setProblem(null);
    setStatus("");
    const response = await sendTestNotificationAction();
    if (response.success) setStatus("Sent. It should be on your phone in a few seconds.");
    else setProblem(response.error.message);
    setBusy(false);
  }

  return (
    <section aria-labelledby="push-heading" className="mt-6">
      <h2 id="push-heading" className="mb-2 text-xs font-semibold text-text-faint">
        Reminders on your phone
      </h2>
      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        {!configured ? (
          <p className="text-sm text-text-muted">
            Phone reminders are not set up on this server. See “Phone reminders” in ops/README.md.
          </p>
        ) : (
          <>
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={() => save({ enabled: !settings.enabled })}
                disabled={busy}
                aria-label="Send reminders to my phone"
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text">Send reminders to my phone</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  A morning list of what is due today, and a heads-up before events and planned tasks,
                  through the ntfy app, even when no Anamnesis tab is open. Off by default.
                </span>
              </span>
            </label>

            {settings.enabled && (
              <div className="mt-3 flex flex-col gap-3 border-t border-border-subtle pt-3">
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Before events and planned tasks
                    <select
                      value={settings.prefs.leadMinutes}
                      onChange={(event) => save({ leadMinutes: Number(event.target.value) })}
                      disabled={busy}
                      className={field}
                    >
                      {LEAD_CHOICES.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Tasks due today
                    <select
                      value={settings.prefs.digestHour}
                      onChange={(event) => save({ digestHour: Number(event.target.value) })}
                      disabled={busy}
                      className={field}
                    >
                      {DIGEST_HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          at {String(hour).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="flex min-h-11 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={settings.prefs.showTitles}
                    onChange={() => save({ showTitles: !settings.prefs.showTitles })}
                    disabled={busy}
                    aria-label="Show titles"
                    className="mt-0.5 size-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text">Show titles</span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      iOS can hide them on the lock screen: Settings › Notifications › Show Previews.
                    </span>
                  </span>
                </label>

                {settings.topic && (
                  <p className="text-xs text-text-muted">
                    In the ntfy app, subscribe to{" "}
                    <code className="break-all rounded bg-surface-subtle px-1 py-0.5 font-mono text-text">
                      {settings.topic}
                    </code>
                    {serverAddress ? (
                      <>
                        {" "}on{" "}
                        <code className="break-all rounded bg-surface-subtle px-1 py-0.5 font-mono text-text">
                          {serverAddress}
                        </code>
                      </>
                    ) : (
                      " on your ntfy server"
                    )}
                    , signed in as the reader set up in ops/README.md.
                  </p>
                )}

                <div>
                  <button type="button" onClick={test} disabled={busy} className={quiet}>
                    Send a test
                  </button>
                </div>
              </div>
            )}

            {settings.lastError && settings.enabled && (
              <p className="mt-3 text-xs text-warn">
                The last reminder could not be sent: {settings.lastError}. It is tried again, three times in all.
              </p>
            )}
          </>
        )}

        <p role="status" className="mt-2 min-h-4 text-xs text-text-muted empty:hidden">
          {status}
        </p>
        {problem && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}
