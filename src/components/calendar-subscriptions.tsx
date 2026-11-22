"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { ApiResponse } from "@/lib/api-response";
import { PROVIDER_STEPS, SYNC_INTERVAL_MINUTES, type ProviderId } from "@/lib/calendar-source";
import {
  addSubscriptionAction,
  syncSubscriptionAction,
  removeSubscriptionAction,
} from "@/actions/calendars";

export type SubscriptionRow = {
  id: string;
  name: string;
  /** Who the link belongs to ("Google Calendar") and its host with an ellipsis: the link itself is a secret and never reaches the browser. */
  provider: string;
  address: string;
  lastSyncedAt: string | null;
  lastEventCount: number;
  /** Why the last try failed, if it did, in words with no address in them. */
  lastError: string | null;
};

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Importing…" : "Import calendar"}
    </button>
  );
}

function Row({ subscription, autoSync }: { subscription: SubscriptionRow; autoSync: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">
          {subscription.name}
        </p>
        <p className="truncate text-xs text-text-muted">
          {subscription.provider} · {subscription.address}
        </p>
        <p className="text-xs text-text-muted">
          {subscription.lastEventCount} events
          {subscription.lastSyncedAt
            ? ` · synced ${subscription.lastSyncedAt}`
            : " · not synced yet"}
          {autoSync ? ` · updates itself about every ${SYNC_INTERVAL_MINUTES} minutes` : ""}
        </p>
        {subscription.lastError && (
          <p className="text-xs font-semibold text-warn">
            The last try failed: {subscription.lastError}{" "}
            {subscription.lastSyncedAt ? "The events from the last good sync are still shown." : "Nothing has been imported yet."}
          </p>
        )}
        {message && <p className="text-xs text-text-muted">{message}</p>}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await syncSubscriptionAction(subscription.id);
            if (result.success) {
              setMessage(
                `Updated — ${result.data.imported} events, ${result.data.removed} removed.`,
              );
              // The row's own counts are server-rendered; without this the
              // "synced" line still shows the previous run.
              router.refresh();
            } else {
              setError(result.error.message);
            }
          });
        }}
        className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              `Remove “${subscription.name}” and the events it imported? Your own events are not touched.`,
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await removeSubscriptionAction(subscription.id);
            if (!result.success) setError(result.error.message);
            else router.refresh();
          });
        }}
        className="rounded-lg px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-60"
      >
        Remove
      </button>
    </li>
  );
}

const HELP_ORDER: ProviderId[] = ["google", "outlook", "apple", "other"];

function FindingTheLink() {
  return (
    <details className="rounded-xl border border-border-subtle bg-surface p-4">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text sm:min-h-0">Where do I find the link?</summary>
      <div className="mt-3 flex flex-col gap-4">
        {HELP_ORDER.map((id) => (
          <section key={id} aria-labelledby={`find-${id}`}>
            <h3 id={`find-${id}`} className="text-sm font-semibold text-text">{PROVIDER_STEPS[id].title}</h3>
            <ol className="mt-1 list-decimal pl-5 text-[13px] text-text-muted">
              {PROVIDER_STEPS[id].steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {PROVIDER_STEPS[id].note && <p className="mt-1 text-xs text-text-muted">{PROVIDER_STEPS[id].note}</p>}
          </section>
        ))}
        <p className="text-xs text-text-muted">The link is a secret: anyone who has it can read that calendar. The app keeps it on this machine, never shows it again, and never includes it in an export.</p>
      </div>
    </details>
  );
}

export function CalendarSubscriptions({
  subscriptions,
  autoSync,
}: {
  subscriptions: SubscriptionRow[];
  autoSync: boolean;
}) {
  const [state, formAction] = useActionState<
    ApiResponse<{ imported: number }> | null,
    FormData
  >(addSubscriptionAction, null);

  return (
    <div className="flex flex-col gap-4">
      <form
        action={formAction}
        className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4"
      >
        <input
          name="name"
          placeholder="Calendar name — e.g. Fall timetable"
          required
          maxLength={120}
          aria-label="Calendar name"
          className="w-full rounded-lg border border-control bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <input
          name="url"
          placeholder="https://… .ics"
          required
          maxLength={2000}
          aria-label="Calendar link"
          className="w-full rounded-lg border border-control bg-surface px-3 py-2 font-mono text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />

        {state && !state.success && (
          <p
            role="alert"
            className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {state.error.message}
          </p>
        )}
        {state?.success && (
          <p role="status" className="text-sm text-text-muted">
            Imported {state.data.imported} events.
          </p>
        )}

        <div>
          <AddButton />
        </div>
      </form>

      <FindingTheLink />

      {subscriptions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {subscriptions.map((subscription) => (
            <Row key={subscription.id} subscription={subscription} autoSync={autoSync} />
          ))}
        </ul>
      )}
    </div>
  );
}
