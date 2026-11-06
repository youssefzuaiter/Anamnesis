"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createFeedLinkAction, revokeFeedLinkAction } from "@/actions/calendar-feed";

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const primary = `${button} bg-accent text-on-accent hover:bg-accent-hover`;
const quiet = `${button} border border-control text-text hover:bg-surface-subtle`;

const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

/** Whether an address only works on this computer: a phone cannot reach it. */
const isLocal = (host: string) => /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) || host.endsWith(".localhost");

export function CalendarFeedCard({ active, createdAt }: { active: boolean; createdAt: string | null }) {
  const router = useRouter();
  // The address exists only here, from the moment it is made until the person leaves the page: the
  // server keeps nothing it could show again.
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const guard = useRef(false);

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

  const make = (renewing: boolean) =>
    run(async () => {
      if (renewing && !window.confirm("Make a new link? The old one stops working, and so does every calendar that uses it.")) return;
      const result = await createFeedLinkAction();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setAddress(`${window.location.origin}/api/calendar/${result.data.token}.ics`);
      setStatus("");
      router.refresh();
      // Once it is on screen, the person is taken to it: it is the one thing to copy.
      requestAnimationFrame(() => {
        field.current?.focus();
        field.current?.select();
      });
    });

  const turnOff = () =>
    run(async () => {
      if (!window.confirm("Turn the calendar feed off? Every calendar that uses the link stops getting updates.")) return;
      const result = await revokeFeedLinkAction();
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setAddress(null);
      setStatus("The calendar feed is turned off.");
      router.refresh();
    });

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setStatus("Address copied.");
    } catch {
      field.current?.select();
      setStatus("Select the address and copy it.");
    }
  }

  const url = address ? new URL(address) : null;
  const webcal = url ? `webcal://${url.host}${url.pathname}` : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4 text-sm">
      <p className="text-text-muted">
        Subscribe to your events and dated tasks from a phone or desktop calendar. A task shows as a free-time entry on its planned time, or
        all day on its due date. <strong className="font-medium text-text">Anyone who has the link can read those titles and times</strong>, so
        treat it like a password.
      </p>

      {address && url ? (
        <div className="flex flex-col gap-2">
          <label className="block">
            <span className="mb-1.5 block font-medium text-text">Your calendar feed address</span>
            <input
              ref={field}
              readOnly
              value={address}
              aria-label="Calendar feed address"
              onFocus={(event) => event.currentTarget.select()}
              className="w-full min-w-0 rounded-lg border border-control bg-surface-subtle px-3 py-2 font-mono text-xs text-text"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={primary}>
              Copy address
            </button>
            {webcal && (
              <a href={webcal} className={quiet}>
                Open in a calendar app
              </a>
            )}
          </div>
          <p className="text-xs text-text-muted">
            This is the only time the address is shown: only a scrambled form of it is kept. If you lose it, make a new link.
          </p>
          {isLocal(url.host) && (
            <p role="note" className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              This address uses {url.hostname}, which only works on this computer. Open Settings from the address where the app is served to get one a
              phone can reach, and prefer https so the link is not sent in the clear.
            </p>
          )}
        </div>
      ) : active ? (
        <p className="text-text">
          The calendar feed is <strong className="font-medium">on</strong>
          {createdAt ? `, made on ${dateLabel(createdAt)}` : ""}. The address is not shown again.
        </p>
      ) : (
        <p className="text-text-muted">The calendar feed is off.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {!active && !address ? (
          <button type="button" onClick={() => make(false)} disabled={busy} className={primary}>
            Create link
          </button>
        ) : (
          <>
            <button type="button" onClick={() => make(true)} disabled={busy} className={quiet}>
              Make a new link
            </button>
            <button type="button" onClick={turnOff} disabled={busy} className={quiet}>
              Turn off
            </button>
          </>
        )}
      </div>

      <p role="status" className="min-h-5 text-xs text-text-muted">
        {status}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
