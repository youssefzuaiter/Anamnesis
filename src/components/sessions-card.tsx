"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { revokeOtherSessionsAction, revokeSessionAction, signOutEverywhereAction } from "@/actions/sessions";

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const quiet = `${button} border border-control text-text hover:bg-surface-subtle`;
const danger = `${button} border border-danger text-danger hover:bg-danger-soft`;

export type SessionRow = { id: string; device: string; current: boolean; lastActive: string; signedIn: string };

/** The dates arrive as text made by the server, whose days they are: see CalendarFeedCard. */
export function SessionsCard({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const others = sessions.filter((s) => !s.current).length;

  async function run(work: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  const end = (row: SessionRow) =>
    run(async () => {
      const result = await revokeSessionAction({ sessionId: row.id });
      if (!result.success) return setError(result.error.message);
      setStatus(`Signed out ${row.device}.`);
      router.refresh();
    });

  const endOthers = () =>
    run(async () => {
      if (!window.confirm("Sign out every other device? Each one has to sign in again.")) return;
      const result = await revokeOtherSessionsAction();
      if (!result.success) return setError(result.error.message);
      setStatus(result.data.ended === 1 ? "Signed out 1 other device." : `Signed out ${result.data.ended} other devices.`);
      router.refresh();
    });

  const endAll = () =>
    run(async () => {
      if (!window.confirm("Sign out everywhere, this device included? You will have to sign in again.")) return;
      await signOutEverywhereAction();
    });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4 text-sm">
      <p className="text-text-muted">
        Every browser or device that is signed in to this account. Signing one out ends it at once: its next page or action sends it to the sign-in
        page.
      </p>
      <ul aria-label="Signed-in devices" className="flex flex-col divide-y divide-border-subtle">
        {sessions.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-medium text-text">
                {row.device}
                {row.current && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">This device</span>}
              </p>
              <p className="text-xs text-text-muted">
                Last active {row.lastActive} · signed in {row.signedIn}
              </p>
            </div>
            {!row.current && (
              <button type="button" onClick={() => end(row)} disabled={busy} aria-label={`Sign out ${row.device}, signed in ${row.signedIn}`} className={quiet}>
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={endOthers} disabled={busy || others === 0} className={quiet}>
          Sign out all other devices
        </button>
        <button type="button" onClick={endAll} disabled={busy} className={danger}>
          Sign out everywhere
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-danger">
          {error}
        </p>
      )}
      {/* aria-live, not role="status": Settings keeps one status role per page for older specs. */}
      <p aria-live="polite" className="text-xs text-text-muted">
        {status}
      </p>
    </div>
  );
}
