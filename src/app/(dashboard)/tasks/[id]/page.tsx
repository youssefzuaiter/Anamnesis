import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { getTask } from "@/repositories/task-repository";
import { TaskForm } from "@/components/task-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import {
  updateTaskAction,
  deleteTaskAction,
  deleteTaskSeriesAction,
  setTaskStatusAction,
} from "@/actions/tasks";
import type { TaskPriority } from "@/lib/domain";
import { listProjectOptions } from "@/repositories/project-repository";
import { listCourseOptions } from "@/repositories/course-repository";
import { listGoalOptions } from "@/repositories/goal-repository";
import { StudyTimer } from "@/components/study-timer";


export const metadata = { title: "Task · Nexus" };

function toDateTimeInput(date: Date | null): string {
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toDateInput(date: Date | null): string {
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  const task = await getTask(userId, id);
  if (!task) notFound();

  const [projects, courses, goals] = await Promise.all([
    listProjectOptions(userId),
    listCourseOptions(userId),
    listGoalOptions(userId),
  ]);

  const done = task.status === "done";

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/tasks"
            className="text-sm text-text-muted transition-colors hover:text-text"
          >
            ← Tasks
          </Link>
          {task.recurrenceId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              ↻ Recurring
            </span>
          )}
        </div>

        <form action={setTaskStatusAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="status" value={done ? "todo" : "done"} />
          <button
            type="submit"
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-raised"
          >
            {done ? "Reopen task" : "Mark complete"}
          </button>
        </form>
      </header>

      {done && task.completedAt && (
        <p className="mb-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          Completed{" "}
          {new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }).format(task.completedAt)}
        </p>
      )}

      <div className="mb-4">
        <StudyTimer taskTitle={task.title} />
      </div>

      <TaskForm
        action={updateTaskAction.bind(null, task.id)}
        submitLabel="Save changes"
        projects={projects}
        courses={courses}
        goals={goals}
        initial={{
          title: task.title,
          description: task.description,
          priority: task.priority as TaskPriority,
          tags: task.tags,
          dueDate: toDateInput(task.dueDate),
          estimatedMinutes: task.estimatedMinutes,
          projectId: task.projectId,
          courseId: task.courseId,
          goalId: task.goalId,
          scheduledStart: toDateTimeInput(task.scheduledStart),
          scheduledEnd: toDateTimeInput(task.scheduledEnd),
        }}
      />

      <div className="mt-3 flex items-center gap-1 border-t border-border-subtle pt-3">
        <ConfirmDeleteButton
          action={deleteTaskAction.bind(null, task.id)}
          label="Delete task"
          confirmText="Delete this task?"
        />
        {task.recurrenceId && (
          <ConfirmDeleteButton
            action={deleteTaskSeriesAction.bind(null, task.id)}
            label="Delete this and future occurrences"
            confirmText="Delete this and every later occurrence in the series? Past occurrences are kept."
          />
        )}
      </div>
    </div>
  );
}
