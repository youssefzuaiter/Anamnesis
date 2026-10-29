import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { auth } from "@/auth";
import { getDashboard, type TodayBlock } from "@/services/dashboard-service";
import { daysUntilLabel } from "@/lib/grades";
import { TaskRow } from "@/components/task-row";
import { QuickCapture } from "@/components/quick-capture";
import { PlanDay } from "@/components/plan-day";
import { ShutDownDay } from "@/components/shut-down-day";
import { TodayNote } from "@/components/today-note";
import { dailyTitle } from "@/lib/daily";
import { dateLabel } from "@/lib/note-templates";
import { Reminders } from "@/components/reminders";
import { Icon } from "@/components/icons";
import type { EventModel as Event } from "@/generated/prisma/models";

export const metadata = { title: "Today · Anamnesis" };

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

const DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const CARD = "rounded-xl border border-border-subtle bg-surface shadow-card";

function greeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Events and planned task blocks on one timeline, in the order they happen:
 *  the schedule and the plan are the same question ("what is my day?"). */
type Slot =
  | { kind: "event"; start: Date; end: Date; event: Event }
  | { kind: "block"; start: Date; end: Date; block: TodayBlock };

function Timeline({ slots, now }: { slots: Slot[]; now: Date }) {
  return (
    <ol className="flex flex-col gap-2">
      {slots.map((slot) => {
        const past = slot.end < now;
        const live = slot.start <= now && slot.end >= now;
        const key = slot.kind === "event" ? slot.event.id : slot.block.id;
        return (
          <li key={key} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
            <div
              className={`shrink-0 text-[13px] font-medium tabular-nums sm:w-24 sm:pt-2.5 ${
                past ? "text-text-faint" : "text-text-muted"
              }`}
            >
              {TIME.format(slot.start)} – {TIME.format(slot.end)}
            </div>
            {slot.kind === "event" ? (
              <Link
                href={`/calendar/${slot.event.id}`}
                className={`flex min-w-0 flex-1 items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  live
                    ? "border-accent bg-accent-soft"
                    : "border-[color-mix(in_srgb,var(--accent)_24%,transparent)] bg-accent-soft hover:border-accent"
                }`}
              >
                <Icon name="calendar" className="mt-0.5 size-[18px] text-accent-ink" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${past ? "text-text-muted" : "text-text"}`}>
                    {slot.event.title}
                  </p>
                  {slot.event.location && (
                    <p className="truncate text-[13px] text-text-muted">{slot.event.location}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs font-semibold text-accent-ink">
                  {live ? "Now" : "Event"}
                </span>
              </Link>
            ) : (
              <Link
                href={`/tasks/${slot.block.id}`}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface px-3 py-2.5 transition-colors hover:border-control"
              >
                <Icon name="tasks" className="mt-0.5 size-[18px] text-text-faint" />
                <p
                  className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                    slot.block.done ? "text-text-faint line-through" : "text-text"
                  }`}
                >
                  {slot.block.title}
                </p>
                <span className="shrink-0 text-xs font-semibold text-text-faint">
                  {live ? "Now" : "Planned"}
                </span>
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SectionHeader({
  id,
  title,
  href,
  linkLabel,
}: {
  id: string;
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4">
      <h2 id={id} className="text-base font-bold text-text">
        {title}
      </h2>
      <Link
        href={href}
        className="text-[13px] font-semibold text-accent-ink hover:underline"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-surface-subtle"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
    </div>
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
    nextAssessment,
    cardsDue,
    indexedChunks,
    todayNote,
  } = await getDashboard(userId, now);

  const firstName = session?.user?.name?.split(" ")[0] ?? "there";
  const slots: Slot[] = [
    ...todayEvents.map((event): Slot => ({
      kind: "event",
      start: event.startTime,
      end: event.endTime,
      event,
    })),
    ...todayBlocks.map((block): Slot => ({
      kind: "block",
      start: block.start,
      end: block.end,
      block,
    })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  // A task already on today's timeline is not listed again below it.
  const planned = new Set(todayBlocks.map((block) => block.id));
  const dueOverdue = overdueTasks.filter((task) => !planned.has(task.id));
  const dueToday = todayTasks.filter((task) => !planned.has(task.id));
  const taskCount = overdueTasks.length + todayTasks.length;

  const isEmpty =
    taskCount === 0 &&
    todayEvents.length === 0 &&
    todayBlocks.length === 0 &&
    recentNotes.length === 0 &&
    activeProjects.length === 0 &&
    activeGoals.length === 0;

  const summary = [
    todayEvents.length > 0 ? plural(todayEvents.length, "event") : null,
    taskCount > 0 ? `${plural(taskCount, "task")} due` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-[28px] font-bold leading-tight text-text">
          {greeting(now.getHours())}, {firstName}
        </h1>
        <p className="mt-1.5 text-sm text-text-muted">
          {DAY.format(now)}
          {summary.length > 0 && ` · ${summary.join(", ")}`}
          {overdueTasks.length > 0 && (
            <span className="font-semibold text-warn">
              {" "}· {overdueTasks.length} overdue
            </span>
          )}
          {nextAssessment && (
            <span>
              {" "}· {nextAssessment.title} {daysUntilLabel(nextAssessment.dueDate, now)}
            </span>
          )}
        </p>
      </header>

      <QuickCapture />
      <Reminders />

      {isEmpty ? (
        <div className={`${CARD} px-6 py-12 text-center`}>
          <p className="text-sm text-text-muted">
            Your workspace is empty. Start by writing a{" "}
            <Link href="/notes/new" className="font-semibold text-accent-ink hover:underline">
              note
            </Link>{" "}
            or adding a{" "}
            <Link href="/tasks" className="font-semibold text-accent-ink hover:underline">
              task
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-labelledby="plan-title" className={CARD}>
              <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3 pt-4">
                <h2 id="plan-title" className="text-base font-bold text-text">
                  Today’s plan
                </h2>
                {overdueTasks.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                    <Icon name="clock" className="size-3.5" />
                    {overdueTasks.length} overdue
                  </span>
                )}
                <Link
                  href="/calendar"
                  className="ml-auto text-[13px] font-semibold text-accent-ink hover:underline"
                >
                  Calendar
                </Link>
              </div>

              <div className="flex flex-col gap-4 px-5 pb-5">
                <PlanDay />
                <ShutDownDay />

                {slots.length > 0 ? (
                  <Timeline slots={slots} now={now} />
                ) : (
                  <p className="text-sm text-text-muted">Nothing scheduled today.</p>
                )}

                <div className="border-t border-border-subtle pt-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-xs font-semibold text-text-faint">
                      {todayBlocks.length > 0 ? "Due today, not yet planned" : "Due today"}
                    </h3>
                    <Link
                      href="/tasks"
                      className="text-[13px] font-semibold text-accent-ink hover:underline"
                    >
                      All tasks
                    </Link>
                  </div>
                  {dueOverdue.length + dueToday.length === 0 ? (
                    <p className="pt-2 text-sm text-text-muted">
                      {taskCount === 0 ? "Nothing due today." : "Everything due today is planned."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border-subtle">
                      {dueOverdue.map((task) => (
                        <TaskRow key={task.id} task={task} overdue variant="row" />
                      ))}
                      {dueToday.map((task) => (
                        <TaskRow key={task.id} task={task} variant="row" />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            <div className="flex flex-col gap-6">
              <section aria-labelledby="today-note-title" className={`${CARD} px-5 py-4`}>
                <TodayNote
                  existing={
                    todayNote
                      ? {
                          id: todayNote.id,
                          title: dailyTitle(now),
                          editedLabel: TIME.format(todayNote.updatedAt),
                        }
                      : null
                  }
                  dayLabel={dateLabel(now)}
                />
              </section>

              {nextAssessment && (
                <section aria-labelledby="exam-title" className={`${CARD} px-5 py-4`}>
                  <p id="exam-title" className="text-xs font-semibold text-text-faint">
                    Next exam
                  </p>
                  <p className="mt-1 text-lg font-bold leading-snug text-text">
                    {nextAssessment.title}
                  </p>
                  <p className="text-sm text-text-muted">
                    {nextAssessment.course.code} · {SHORT_DAY.format(nextAssessment.dueDate)} ·{" "}
                    {TIME.format(nextAssessment.dueDate)}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                      {daysUntilLabel(nextAssessment.dueDate, now).replace(/^./, (c) => c.toUpperCase())}
                    </span>
                    <Link
                      href={`/courses/${nextAssessment.course.id}`}
                      className="text-[13px] font-semibold text-accent-ink hover:underline"
                    >
                      Open course
                    </Link>
                  </div>
                </section>
              )}

              {nextEvent && (
                <section aria-labelledby="next-title" className={`${CARD} px-5 py-4`}>
                  <p id="next-title" className="text-xs font-semibold text-text-faint">
                    Next up
                  </p>
                  <Link
                    href={`/calendar/${nextEvent.id}`}
                    className="mt-1 block truncate text-base font-bold text-text hover:text-accent-ink"
                  >
                    {nextEvent.title}
                  </Link>
                  <p className="text-sm text-text-muted">
                    {SHORT_DAY.format(nextEvent.startTime)} · {TIME.format(nextEvent.startTime)}
                  </p>
                </section>
              )}

              <section aria-labelledby="goals-title" className={CARD}>
                <SectionHeader id="goals-title" title="Goals" href="/goals" linkLabel="All goals" />
                {activeGoals.length === 0 ? (
                  <p className="px-5 pb-4 text-sm text-text-muted">No active goals.</p>
                ) : (
                  <ul className="flex flex-col gap-4 px-5 pb-5 pt-1">
                    {activeGoals.map((goal) => (
                      <li key={goal.id}>
                        <Link href={`/goals/${goal.id}`} className="group block">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="truncate text-sm font-semibold text-text group-hover:text-accent-ink">
                              {goal.title}
                            </p>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
                              {goal.progress}%
                            </span>
                          </div>
                          <div className="mt-2">
                            <Progress label={`${goal.title} progress`} value={goal.progress} />
                          </div>
                          <p className="mt-1.5 text-[13px] text-text-faint">
                            {plural(goal.counts.projects, "project")} ·{" "}
                            {plural(goal.counts.tasks, "direct task")}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {cardsDue > 0 && (
                <section
                  aria-labelledby="study-title"
                  className={`${CARD} flex items-center justify-between gap-3 px-5 py-4`}
                >
                  <div>
                    <p id="study-title" className="text-xs font-semibold text-text-faint">
                      Study queue
                    </p>
                    <p className="mt-0.5 text-base font-bold text-text">
                      <span className="tabular-nums">{cardsDue}</span>{" "}
                      {cardsDue === 1 ? "flashcard" : "flashcards"} due
                    </p>
                  </div>
                  <Link
                    href="/cards"
                    className="inline-flex min-h-9 items-center rounded-lg border border-border-strong px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle"
                  >
                    Start review
                  </Link>
                </section>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
            <section aria-labelledby="notes-title" className={CARD}>
              <SectionHeader id="notes-title" title="Recent notes" href="/notes" linkLabel="All notes" />
              {recentNotes.length === 0 ? (
                <p className="px-5 pb-4 text-sm text-text-muted">No notes yet.</p>
              ) : (
                <ul>
                  {recentNotes.map((note) => (
                    <li key={note.id} className="border-t border-border-subtle">
                      <Link
                        href={`/notes/${note.id}`}
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-subtle"
                      >
                        <Icon name="notes" className="size-[18px] text-text-faint" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text">
                            {note.isFavorite && (
                              <>
                                <span aria-hidden="true" className="mr-1 text-accent-ink">
                                  ★
                                </span>
                                <span className="sr-only">Favourite: </span>
                              </>
                            )}
                            {note.title}
                          </p>
                          {note.excerpt && (
                            <p className="truncate text-[13px] text-text-faint">{note.excerpt}</p>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="projects-title" className={CARD}>
              <SectionHeader
                id="projects-title"
                title="Active projects"
                href="/projects"
                linkLabel="All projects"
              />
              {activeProjects.length === 0 ? (
                <p className="px-5 pb-4 text-sm text-text-muted">No active projects.</p>
              ) : (
                <ul>
                  {activeProjects.map((project) => (
                    <li key={project.id} className="border-t border-border-subtle">
                      <Link
                        href={`/projects/${project.id}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 transition-colors hover:bg-surface-subtle"
                      >
                        <Icon name="projects" className="size-[18px] text-text-faint" />
                        <div className="min-w-36 flex-1">
                          <p className="truncate text-sm font-semibold text-text">{project.title}</p>
                          <p className="text-[13px] text-text-faint">
                            {project.counts.openTasks} open of {plural(project.counts.tasks, "task")}
                          </p>
                        </div>
                        <div className="flex w-32 items-center gap-2.5">
                          <div className="flex-1">
                            <Progress label={`${project.title} progress`} value={project.progress} />
                          </div>
                          <span className="text-[13px] font-semibold tabular-nums text-text">
                            {project.progress}%
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="text-center text-xs text-text-faint">
            Press <kbd className="font-sans font-semibold">⌘J</kbd> or{" "}
            <kbd className="font-sans font-semibold">Ctrl J</kbd> to ask about your workspace ·{" "}
            {plural(indexedChunks, "chunk")} indexed
          </p>
        </>
      )}
    </div>
  );
}
