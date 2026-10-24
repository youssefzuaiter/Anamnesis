"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { scheduleTaskAction } from "@/actions/tasks";
import { TASK_DRAG_MIME } from "@/lib/domain";
import type { CalendarDay } from "@/services/event-service";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Shared by the month/week grid cells and the day agenda: accepts a dropped
 * task id, calls the schedule action, then refreshes — the action is called
 * directly (not through a form), so nothing else tells the already-rendered
 * server data to catch up.
 */
function useTaskDrop(date: Date) {
  const router = useRouter();
  const [isOver, setIsOver] = useState(false);
  const [isDropping, setIsDropping] = useState(false);

  return {
    isOver,
    isDropping,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(TASK_DRAG_MIME)) return;
        e.preventDefault();
      },
      onDragEnter: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(TASK_DRAG_MIME)) return;
        setIsOver(true);
      },
      onDragLeave: () => setIsOver(false),
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        setIsOver(false);
        const taskId = e.dataTransfer.getData(TASK_DRAG_MIME);
        if (!taskId) return;
        setIsDropping(true);
        await scheduleTaskAction(taskId, dateKey(date));
        setIsDropping(false);
        router.refresh();
      },
    },
  };
}

function DroppableDayCell({ day, tall }: { day: CalendarDay; tall: boolean }) {
  const { isOver, isDropping, handlers } = useTaskDrop(day.date);
  const cap = tall ? 6 : 5;
  const shownTasks = day.tasks.slice(0, cap);
  const remainingAfterTasks = cap - shownTasks.length;
  const shownEvents = day.events.slice(0, Math.max(remainingAfterTasks, tall ? 4 : 3));
  const hiddenCount = day.events.length + day.tasks.length - shownTasks.length - shownEvents.length;

  return (
    <div
      {...handlers}
      className={`${tall ? "min-h-40" : "min-h-24"} p-1.5 transition-colors ${
        day.inCurrentMonth ? "bg-surface" : "bg-canvas"
      } ${isOver ? "bg-accent-soft ring-2 ring-inset ring-accent" : ""} ${
        isDropping ? "opacity-60" : ""
      }`}
    >
      <span
        className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
          day.isToday
            ? "bg-accent text-on-accent"
            : day.inCurrentMonth
              ? "text-text-muted"
              : "text-text-faint"
        }`}
      >
        {day.date.getDate()}
      </span>

      <ul className="mt-1 flex flex-col gap-0.5">
        {shownTasks.map((task) => (
          <li key={task.id}>
            <Link
              href={`/tasks/${task.id}`}
              title={`${formatTime(task.start)} ${task.title} (time block)`}
              className={`block truncate rounded-md border-[1.5px] border-dashed border-border-strong px-1.5 py-0.5 text-xs leading-tight transition-colors hover:border-control ${
                task.done ? "text-text-faint line-through" : "text-text-muted"
              }`}
            >
              {formatTime(task.start)} {task.recurring && "↻ "}
              {task.title}
            </Link>
          </li>
        ))}
        {shownEvents.map((event) => (
          <li key={event.id}>
            <Link
              href={`/calendar/${event.id}`}
              title={`${formatTime(event.startTime)} ${event.title}`}
              className="block truncate rounded-md border border-[color-mix(in_srgb,var(--accent)_26%,transparent)] bg-accent-soft px-1.5 py-0.5 text-xs font-medium leading-tight text-accent-ink transition-colors hover:border-accent"
            >
              {formatTime(event.startTime)} {event.recurrenceId && "↻ "}
              {event.title}
            </Link>
          </li>
        ))}
        {hiddenCount > 0 && (
          <li className="px-1 text-xs text-text-faint">+{hiddenCount} more</li>
        )}
      </ul>
    </div>
  );
}

export function CalendarGrid({ days, tall }: { days: CalendarDay[]; tall: boolean }) {
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border-subtle bg-border-subtle">
      {days.map((day) => (
        <DroppableDayCell key={day.date.toISOString()} day={day} tall={tall} />
      ))}
    </div>
  );
}

type AgendaItem =
  | { kind: "event"; id: string; start: Date; end: Date; title: string; location: string | null; recurring: boolean }
  | { kind: "task"; id: string; start: Date; end: Date; title: string; done: boolean; recurring: boolean };

export function DayAgenda({ day }: { day: CalendarDay | undefined }) {
  const { isOver, isDropping, handlers } = useTaskDrop(day?.date ?? new Date());
  if (!day) return null;

  const items: AgendaItem[] = [
    ...day.events.map((e): AgendaItem => ({
      kind: "event",
      id: e.id,
      start: e.startTime,
      end: e.endTime,
      title: e.title,
      location: e.location,
      recurring: Boolean(e.recurrenceId),
    })),
    ...day.tasks.map((t): AgendaItem => ({
      kind: "task",
      id: t.id,
      start: t.start,
      end: t.end,
      title: t.title,
      done: t.done,
      recurring: t.recurring,
    })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <div
      {...handlers}
      className={`min-h-[6rem] rounded-xl transition-colors ${
        isOver ? "bg-accent-soft ring-2 ring-accent" : ""
      } ${isDropping ? "opacity-60" : ""}`}
    >
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          Nothing scheduled for this day. Drag an unscheduled task here to block time for it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <Link
                href={item.kind === "event" ? `/calendar/${item.id}` : `/tasks/${item.id}`}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  item.kind === "event"
                    ? "border-border-subtle bg-surface hover:border-border-strong"
                    : "border-dashed border-border-strong hover:border-accent"
                }`}
              >
                <span className="w-24 shrink-0 text-xs text-text-muted">
                  {formatTime(item.start)}–{formatTime(item.end)}
                </span>
                <span className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${
                      item.kind === "task" && item.done
                        ? "text-text-faint line-through"
                        : "text-text"
                    }`}
                  >
                    {item.recurring && "↻ "}
                    {item.title}
                    {item.kind === "task" && (
                      <span className="ml-2 rounded-full bg-surface-subtle px-1.5 py-0.5 text-xs font-medium text-text-faint">
                        time block
                      </span>
                    )}
                  </p>
                  {item.kind === "event" && item.location && (
                    <p className="mt-0.5 truncate text-xs text-text-muted">{item.location}</p>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
