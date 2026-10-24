import Link from "next/link";
import { requireUserId } from "@/lib/session";
import {
  buildMonthGrid,
  buildWeekGrid,
  buildDayGrid,
  startOfWeek,
} from "@/services/event-service";
import { listUpcomingEvents } from "@/repositories/event-repository";
import { listUnscheduled } from "@/repositories/task-repository";
import { EventForm } from "@/components/event-form";
import { createEventAction } from "@/actions/events";
import { listProjectOptions } from "@/repositories/project-repository";
import { CalendarGrid, DayAgenda } from "@/components/calendar-dnd";
import { UnscheduledTasks } from "@/components/unscheduled-tasks";

export const metadata = { title: "Calendar · Anamnesis" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEWS = ["month", "week", "day"] as const;
type View = (typeof VIEWS)[number];

function parseView(raw: string | undefined): View {
  return (VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as View)
    : "month";
}

function parseMonth(raw: string | undefined, now: Date) {
  const match = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (!match) return { year: now.getFullYear(), month: now.getMonth() };

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11 || year < 1970 || year > 9999) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year, month };
}

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function parseDateParam(raw: string | undefined, now: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? "");
  const fallback = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!match) return fallback;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function dateParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const userId = await requireUserId();
  const params = await searchParams;
  const now = new Date();

  const view = parseView(typeof params.view === "string" ? params.view : undefined);
  const { year, month } = parseMonth(
    typeof params.month === "string" ? params.month : undefined,
    now,
  );
  const weekRef = parseDateParam(typeof params.week === "string" ? params.week : undefined, now);
  const dayRef = parseDateParam(typeof params.date === "string" ? params.date : undefined, now);

  // A single reference date per view, used both to fetch the grid and to build
  // the links for switching between views without losing your place.
  const referenceDate =
    view === "week" ? weekRef : view === "day" ? dayRef : new Date(year, month, 1);

  const [days, upcoming, projects, unscheduled] = await Promise.all([
    view === "week"
      ? buildWeekGrid(userId, referenceDate, now)
      : view === "day"
        ? buildDayGrid(userId, referenceDate, now)
        : buildMonthGrid(userId, year, month, now),
    listUpcomingEvents(userId, now, 5),
    listProjectOptions(userId),
    listUnscheduled(userId),
  ]);

  const monthHref = (y: number, m: number) => `/calendar?view=month&month=${monthParam(y, m)}`;
  const weekHref = (d: Date) => `/calendar?view=week&week=${dateParam(startOfWeek(d))}`;
  const dayHref = (d: Date) => `/calendar?view=day&date=${dateParam(d)}`;

  let title: string;
  let prevHref: string;
  let nextHref: string;
  let todayHref: string;

  if (view === "week") {
    const weekStart = startOfWeek(referenceDate);
    const weekEnd = addDays(weekStart, 6);
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    title = sameMonth
      ? `${new Intl.DateTimeFormat("en-GB", { day: "numeric" }).format(weekStart)}–${new Intl.DateTimeFormat(
          "en-GB",
          { day: "numeric", month: "long", year: "numeric" },
        ).format(weekEnd)}`
      : `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(weekStart)} – ${new Intl.DateTimeFormat(
          "en-GB",
          { day: "numeric", month: "short", year: "numeric" },
        ).format(weekEnd)}`;
    prevHref = weekHref(addDays(weekStart, -7));
    nextHref = weekHref(addDays(weekStart, 7));
    todayHref = weekHref(now);
  } else if (view === "day") {
    title = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(referenceDate);
    prevHref = dayHref(addDays(referenceDate, -1));
    nextHref = dayHref(addDays(referenceDate, 1));
    todayHref = dayHref(now);
  } else {
    title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
      new Date(year, month, 1),
    );
    prevHref = month === 0 ? monthHref(year - 1, 11) : monthHref(year, month - 1);
    nextHref = month === 11 ? monthHref(year + 1, 0) : monthHref(year, month + 1);
    todayHref = monthHref(now.getFullYear(), now.getMonth());
  }

  // A multi-day entry appears in several day cells, so count distinct ids.
  const counted = view === "month" ? days.filter((d) => d.inCurrentMonth) : days;
  const eventCount = new Set(counted.flatMap((d) => d.events.map((e) => e.id))).size;
  const blockCount = new Set(counted.flatMap((d) => d.tasks.map((t) => t.id))).size;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {eventCount} {eventCount === 1 ? "event" : "events"}
            {view === "month" ? " this month" : view === "week" ? " this week" : " today"}
            {blockCount > 0 &&
              ` · ${blockCount} time ${blockCount === 1 ? "block" : "blocks"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex items-center gap-0.5 rounded-lg border border-border-subtle p-0.5">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={v === "week" ? weekHref(referenceDate) : v === "day" ? dayHref(referenceDate) : monthHref(referenceDate.getFullYear(), referenceDate.getMonth())}
                className={`rounded-md px-2.5 py-1 text-sm capitalize transition-colors ${
                  v === view
                    ? "bg-accent text-on-accent"
                    : "text-text-muted hover:bg-surface-subtle"
                }`}
              >
                {v}
              </Link>
            ))}
          </nav>
          <nav className="flex items-center gap-1.5">
            <Link
              href={prevHref}
              aria-label={`Previous ${view}`}
              className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-sm text-text transition-colors hover:bg-surface-subtle"
            >
              ←
            </Link>
            <Link
              href={todayHref}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-subtle"
            >
              Today
            </Link>
            <Link
              href={nextHref}
              aria-label={`Next ${view}`}
              className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-sm text-text transition-colors hover:bg-surface-subtle"
            >
              →
            </Link>
            <Link
              href="/calendar/subscriptions"
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-subtle"
            >
              Import
            </Link>
          </nav>
        </div>
      </header>

      {view === "day" ? (
        <DayAgenda day={days[0]} />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-7 gap-px">
              {days.slice(0, 7).map((day, i) => (
                <div
                  key={i}
                  className="pb-1.5 text-center text-xs font-medium text-text-faint"
                >
                  {view === "week"
                    ? `${WEEKDAYS[i]} ${day.date.getDate()}`
                    : WEEKDAYS[i]}
                </div>
              ))}
            </div>

            <CalendarGrid days={days} tall={view === "week"} />
          </div>
        </div>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <h2 className="mb-2 text-xs font-semibold text-text-faint">
            Add event
          </h2>
          <EventForm
            action={createEventAction}
            submitLabel="Add event"
            projects={projects}
            resetOnSuccess
          />
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold text-text-faint">
            Unscheduled · {unscheduled.length}
          </h2>
          <p className="mb-2 text-xs text-text-faint">
            Drag a task onto a day to block time for it.
          </p>
          <UnscheduledTasks tasks={unscheduled} />
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold text-text-faint">
            Next up
          </h2>
          {upcoming.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-text-muted">
              Nothing scheduled.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {upcoming.map((event) => (
                <li key={event.id}>
                  <Link
                    href={`/calendar/${event.id}`}
                    className="block rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
                  >
                    <p className="truncate text-sm font-medium text-text">
                      {event.title}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {new Intl.DateTimeFormat("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      }).format(event.startTime)}
                      {" · "}
                      {formatTime(event.startTime)}–{formatTime(event.endTime)}
                      {event.location && ` · ${event.location}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
