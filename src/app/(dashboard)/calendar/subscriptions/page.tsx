import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listSubscriptions } from "@/services/calendar-service";
import { CalendarSubscriptions } from "@/components/calendar-subscriptions";

export const metadata = { title: "Imported calendars · Anamnesis" };

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function SubscriptionsPage() {
  const userId = await requireUserId();
  const subscriptions = await listSubscriptions(userId);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link href="/calendar" className="text-sm text-accent hover:underline">
          ← Calendar
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          Imported calendars
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Paste the .ics link your university publishes and its classes appear on
          your calendar. Syncing again updates the same events rather than
          duplicating them, and drops any that were cancelled.
        </p>
      </header>

      <CalendarSubscriptions
        subscriptions={subscriptions.map((subscription) => ({
          id: subscription.id,
          name: subscription.name,
          url: subscription.url,
          lastSyncedAt: subscription.lastSyncedAt
            ? WHEN.format(subscription.lastSyncedAt)
            : null,
          lastEventCount: subscription.lastEventCount,
        }))}
      />

      <p className="mt-4 text-xs text-text-muted">
        Imported events are read-only copies of the feed: editing them here would
        be overwritten on the next sync. Removing a calendar removes the events it
        brought in, and never touches events you created yourself.
      </p>
    </div>
  );
}
