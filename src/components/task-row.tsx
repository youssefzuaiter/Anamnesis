import Link from "next/link";
import { setTaskStatusAction } from "@/actions/tasks";
import { Icon } from "@/components/icons";
import type { TaskModel as Task } from "@/generated/prisma/models";

// Amber means "needs attention", so it marks high priority and overdue; red is
// kept for destructive actions and errors.
const PRIORITY_STYLES: Record<string, string> = {
  high: "font-semibold text-warn",
  medium: "text-text-muted",
  low: "text-text-faint",
};

function formatDue(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function TaskRow({
  task,
  overdue,
  variant = "card",
}: {
  task: Task;
  overdue?: boolean;
  /** `row` drops the card chrome, for lists that already sit inside a card. */
  variant?: "card" | "row";
}) {
  const done = task.status === "done";

  return (
    <li
      className={`flex items-start gap-3 ${
        variant === "card"
          ? "rounded-xl border border-border-subtle bg-surface px-4 py-3"
          : "py-2.5"
      }`}
    >
      <form action={setTaskStatusAction} className="pt-0.5">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="status" value={done ? "todo" : "done"} />
        {/* A 20px box with a 44px hit area: the ::after extends the target
            without moving anything around it. */}
        <button
          type="submit"
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          className={`relative flex size-5 items-center justify-center rounded-md border-[1.5px] transition-colors after:absolute after:-inset-3 after:content-[''] ${
            done
              ? "border-accent bg-accent text-on-accent"
              : "border-control bg-surface hover:border-accent"
          }`}
        >
          {done && <Icon name="check" className="size-3.5" strokeWidth={2.5} />}
        </button>
      </form>

      <div className="min-w-0 flex-1">
        <Link
          href={`/tasks/${task.id}`}
          className={`block truncate text-sm font-semibold transition-colors hover:text-accent ${
            done ? "text-text-faint line-through" : "text-text"
          }`}
        >
          {task.recurrenceId && "↻ "}
          {task.title}
        </Link>

        {task.description && !done && (
          <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">
            {task.description}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {task.dueDate && (
            <span className={overdue ? "font-semibold text-warn" : "text-text-faint"}>
              {overdue ? "Overdue · " : ""}
              {formatDue(task.dueDate)}
            </span>
          )}
          <span className={PRIORITY_STYLES[task.priority]}>{task.priority}</span>
          <span className="tabular-nums text-text-faint">{task.estimatedMinutes}m</span>
          {task.tags.map((name) => (
            <span
              key={name}
              className="rounded-full bg-surface-subtle px-2 py-0.5 font-medium text-text-muted"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}
