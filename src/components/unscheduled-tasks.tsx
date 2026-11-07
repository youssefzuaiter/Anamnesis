"use client";

import Link from "next/link";
import { TASK_DRAG_MIME, TASK_MINUTES_MIME_PREFIX } from "@/lib/domain";

export type UnscheduledTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: string;
  estimatedMinutes: number;
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "text-danger",
  medium: "text-text-muted",
  low: "text-text-faint",
};

function formatDue(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

export function UnscheduledTasks({ tasks }: { tasks: UnscheduledTask[] }) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-text-muted">
        Nothing unscheduled.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {tasks.map((task) => (
        <li
          key={task.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(TASK_DRAG_MIME, task.id);
            // Only the types of a drag can be read while it is still over a target: the hourly grid reads the
            // estimate here to draw where the block would land.
            e.dataTransfer.setData(`${TASK_MINUTES_MIME_PREFIX}${task.estimatedMinutes}`, "");
            e.dataTransfer.effectAllowed = "move";
          }}
          title="Drag onto the calendar to block time for it"
          className="flex cursor-grab items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text transition-colors hover:border-accent active:cursor-grabbing"
        >
          <Link
            href={`/tasks/${task.id}`}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate hover:text-accent"
          >
            {task.title}
          </Link>
          {task.dueDate && (
            <span className="shrink-0 text-xs text-text-faint">{formatDue(task.dueDate)}</span>
          )}
          <span className={`shrink-0 text-xs ${PRIORITY_STYLES[task.priority] ?? "text-text-muted"}`}>
            {task.priority}
          </span>
        </li>
      ))}
    </ul>
  );
}
