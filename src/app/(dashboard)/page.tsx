import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { auth } from "@/auth";
import { getDashboard } from "@/services/dashboard-service";
import { TaskRow } from "@/components/task-row";
import { QuickCapture } from "@/components/quick-capture";
import { PlanDay } from "@/components/plan-day";
import { Reminders } from "@/components/reminders";
import type { EventModel as Event } from "@/generated/prisma/models";

export const metadata = { title: "Dashboard · Nexus" };

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

const DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function greeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function EventRow({ event, now }: { event: Event; now: Date }) {
  const past = event.endTime < now;
  const live = event.startTime <= now && event.endTime >= now;

  return (
    <li
      className={`flex gap-3 rounded-xl border bg-surface px-4 py-3 ${
        live ? "border-accent" : "border-border-subtle"
      } ${past ? "opacity-50" : ""}`}
    >
      <div className="shrink-0 text-xs tabular-nums text-text-muted">
        <div>{TIME.format(event.startTime)}</div>
        <div className="text-text-faint">{TIME.format(event.endTime)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={`/calendar/${event.id}`}
          className="block truncate text-sm font-medium text-text transition-colors hover:text-accent"
        >
          {event.title}
        </Link>
        {event.location && (
          <p className="truncate text-xs text-text-muted">{event.location}</p>
        )}
      </div>
      {live && (
        <span className="shrink-0 self-start rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
          Now
        </span>
      )}
    </li>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-faint">
          {title}
        </h2>
        {href && (
          <Link
            href={href}
            className="text-xs text-text-muted transition-colors hover:text-accent"
          >
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted">
      {children}
    </p>
  );
}

export default async function DashboardPage() {
  const userId = await requireUserId();
  const session = await auth();
  const now = new Date();

  const {
    overdueTasks,
    todayTasks,
    todayEvents,
    todayBlocks,
    nextEvent,
    recentNotes,
    activeProjects,
    activeGoals,
    indexedChunks,
  } = await getDashboard(userId, now);

  const firstName = session?.user?.name?.split(" ")[0] ?? "there";
  const focusCount = overdueTasks.length + todayTasks.length;
  const isEmpty =
    focusCount === 0 &&
    todayEvents.length === 0 &&
    todayBlocks.length === 0 &&
    recentNotes.length === 0 &&
    activeProjects.length === 0 &&
    activeGoals.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {greeting(now.getHours())}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {DAY.format(now)}
          {focusCount > 0 &&
            ` · ${focusCount} ${focusCount === 1 ? "task" : "tasks"} to focus on`}
          {todayEvents.length > 0 &&
            ` · ${todayEvents.length} ${todayEvents.length === 1 ? "event" : "events"}`}
        </p>
      </header>

      <QuickCapture />

      <div className="mt-4">
        <Reminders />
      </div>

      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="text-sm text-text-muted">
            Your workspace is empty. Start by writing a{" "}
            <Link href="/notes/new" className="text-accent hover:underline">
              note
            </Link>{" "}
            or adding a{" "}
            <Link href="/tasks" className="text-accent hover:underline">
              task
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <PlanDay />

          <Panel title="Today" href="/tasks" linkLabel="All tasks">
            {focusCount === 0 ? (
              <Empty>Nothing due today.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {overdueTasks.map((task) => (
                  <TaskRow key={task.id} task={task} overdue />
                ))}
                {todayTasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Schedule" href="/calendar" linkLabel="Calendar">
            {todayBlocks.length > 0 && (
              <ul className="mb-2 flex flex-col gap-2">
                {todayBlocks.map((block) => (
                  <li
                    key={block.id}
                    className="flex gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-3"
                  >
                    <div className="shrink-0 text-xs tabular-nums text-text-muted">
                      <div>{TIME.format(block.start)}</div>
                      <div className="text-text-faint">{TIME.format(block.end)}</div>
                    </div>
                    <Link
                      href={`/tasks/${block.id}`}
                      className={`min-w-0 flex-1 truncate text-sm transition-colors hover:text-accent ${
                        block.done ? "text-text-faint line-through" : "text-text"
                      }`}
                    >
                      {block.title}
                    </Link>
                    <span className="shrink-0 self-start text-[11px] text-text-faint">
                      Time block
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {todayEvents.length === 0 ? (
              nextEvent ? (
                <ul className="flex flex-col gap-2">
                  <li className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
                    <p className="text-xs text-text-faint">Next up</p>
                    <Link
                      href={`/calendar/${nextEvent.id}`}
                      className="mt-0.5 block truncate text-sm font-medium text-text transition-colors hover:text-accent"
                    >
                      {nextEvent.title}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {DAY.format(nextEvent.startTime)} ·{" "}
                      {TIME.format(nextEvent.startTime)}
                    </p>
                  </li>
                </ul>
              ) : todayBlocks.length === 0 ? (
                <Empty>Nothing scheduled today.</Empty>
              ) : null
            ) : (
              <ul className="flex flex-col gap-2">
                {todayEvents.map((event) => (
                  <EventRow key={event.id} event={event} now={now} />
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid gap-6 sm:grid-cols-2">
            <Panel title="Recent notes" href="/notes" linkLabel="All notes">
              {recentNotes.length === 0 ? (
                <Empty>No notes yet.</Empty>
              ) : (
                <ul className="flex flex-col gap-2">
                  {recentNotes.map((note) => (
                    <li key={note.id}>
                      <Link
                        href={`/notes/${note.id}`}
                        className="block rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
                      >
                        <p className="truncate text-sm font-medium text-text">
                          {note.isFavorite && (
                            <span className="mr-1 text-accent">★</span>
                          )}
                          {note.title}
                        </p>
                        {note.excerpt && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">
                            {note.excerpt}
                          </p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Active projects" href="/projects" linkLabel="All projects">
              {activeProjects.length === 0 ? (
                <Empty>No active projects.</Empty>
              ) : (
                <ul className="flex flex-col gap-2">
                  {activeProjects.map((project) => (
                    <li key={project.id}>
                      <Link
                        href={`/projects/${project.id}`}
                        className="block rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-text">
                            {project.title}
                          </p>
                          <span className="shrink-0 text-xs tabular-nums text-text-muted">
                            {project.progress}%
                          </span>
                        </div>
                        <div
                          className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-raised"
                          role="progressbar"
                          aria-valuenow={project.progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${project.title} progress`}
                        >
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-text-faint">
                          {project.counts.openTasks} open of{" "}
                          {project.counts.tasks} tasks
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Active goals" href="/goals" linkLabel="All goals">
            {activeGoals.length === 0 ? (
              <Empty>No active goals.</Empty>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {activeGoals.map((goal) => (
                  <li key={goal.id}>
                    <Link
                      href={`/goals/${goal.id}`}
                      className="block rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-text">
                          {goal.title}
                        </p>
                        <span className="shrink-0 text-xs tabular-nums text-text-muted">
                          {goal.progress}%
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-raised"
                        role="progressbar"
                        aria-valuenow={goal.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${goal.title} progress`}
                      >
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${goal.progress}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-text-faint">
                        {goal.counts.projects} projects · {goal.counts.tasks}{" "}
                        direct tasks
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <p className="text-center text-xs text-text-faint">
            <Link href="/ai" className="transition-colors hover:text-accent">
              Ask your workspace
            </Link>{" "}
            · {indexedChunks} {indexedChunks === 1 ? "chunk" : "chunks"} indexed
          </p>
        </div>
      )}
    </div>
  );
}
