import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { getEvent, listLaterSeriesEvents } from "@/repositories/event-repository";
import { getSubscription } from "@/repositories/calendar-repository";
import { providerOf } from "@/lib/calendar-source";
import { EventForm } from "@/components/event-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { updateEventAction, deleteEventAction, deleteEventSeriesAction } from "@/actions/events";
import { listProjectOptions } from "@/repositories/project-repository";


export const metadata = { title: "Event · Anamnesis" };

function toDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default async function EventPage({ params }: PageProps<"/calendar/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  const event = await getEvent(userId, id);
  if (!event) notFound();

  // An imported event says where it came from: the feed's name and its provider, never its link.
  const source = event.subscriptionId ? await getSubscription(userId, event.subscriptionId) : null;
  const [projects, later] = await Promise.all([
    listProjectOptions(userId),
    event.recurrenceId
      ? listLaterSeriesEvents(userId, event.recurrenceId, event.startTime, event.id)
      : Promise.resolve([]),
  ]);

  const monthParam = `${event.startTime.getFullYear()}-${String(
    event.startTime.getMonth() + 1,
  ).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <Link
          href={`/calendar?month=${monthParam}`}
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Calendar
        </Link>
        {event.recurrenceId && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            ↻ Recurring
          </span>
        )}
        {source && (
          <p className="mt-2 text-xs text-text-muted">
            Imported from <strong className="text-text">{source.name}</strong> ({providerOf(source.url).label}). Changes made here are replaced at the next sync.{" "}
            <Link href="/calendar/subscriptions" className="font-semibold text-accent-ink underline-offset-2 hover:underline">Imported calendars</Link>
          </p>
        )}
      </header>

      <EventForm
        action={updateEventAction.bind(null, event.id)}
        submitLabel="Save changes"
        projects={projects}
        series={{ later: later.length }}
        initial={{
          title: event.title,
          description: event.description,
          location: event.location,
          startTime: toDateTimeInput(event.startTime),
          endTime: toDateTimeInput(event.endTime),
          projectId: event.projectId,
        }}
      />

      <div className="mt-3 flex items-center gap-1 border-t border-border-subtle pt-3">
        <ConfirmDeleteButton
          action={deleteEventAction.bind(null, event.id)}
          label="Delete event"
          confirmText="Delete this event?"
        />
        {event.recurrenceId && (
          <ConfirmDeleteButton
            action={deleteEventSeriesAction.bind(null, event.id)}
            label="Delete this and future occurrences"
            confirmText="Delete this and every later occurrence in the series? Past occurrences are kept."
          />
        )}
      </div>
    </div>
  );
}
