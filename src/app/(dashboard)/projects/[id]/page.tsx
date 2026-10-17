import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import {
  getProject,
  getProjectContents,
} from "@/repositories/project-repository";
import { listGoalOptions } from "@/repositories/goal-repository";
import type { ProjectCategory } from "@/lib/domain";
import { ProjectForm } from "@/components/project-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { TaskRow } from "@/components/task-row";
import { updateProjectAction, deleteProjectAction } from "@/actions/projects";

export const metadata = { title: "Project · Nexus" };

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export default async function ProjectPage({
  params,
}: PageProps<"/projects/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  const project = await getProject(userId, id);
  if (!project) notFound();

  const [{ notes, tasks, events }, goals] = await Promise.all([
    getProjectContents(userId, id),
    listGoalOptions(userId),
  ]);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");
  const goal = project.goalId
    ? goals.find((g) => g.id === project.goalId)
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link
          href="/projects"
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          {project.title}
        </h1>
        {goal && (
          <Link
            href={`/goals/${goal.id}`}
            className="mt-1 inline-block text-sm text-text-muted transition-colors hover:text-text"
          >
            Goal: {goal.title}
          </Link>
        )}
        <div className="mt-3 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-valuenow={project.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Project progress"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${project.progress}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-text-muted">
            {project.progress}% · {doneTasks.length}/{tasks.length} tasks done
          </span>
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-faint">
          Tasks · {tasks.length}
        </h2>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted">
            No tasks yet. Assign one from the{" "}
            <Link href="/tasks" className="text-accent hover:underline">
              Tasks
            </Link>{" "}
            page.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...openTasks, ...doneTasks].map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-faint">
            Notes · {notes.length}
          </h2>
          {notes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted">
              No notes linked.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((note) => (
                <li key={note.id}>
                  <Link
                    href={`/notes/${note.id}`}
                    className="block truncate rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 text-sm text-text transition-colors hover:border-border-strong"
                  >
                    {note.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-faint">
            Events · {events.length}
          </h2>
          {events.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted">
              No events linked.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {events.map((event) => (
                <li key={event.id}>
                  <Link
                    href={`/calendar/${event.id}`}
                    className="block rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
                  >
                    <p className="truncate text-sm text-text">{event.title}</p>
                    <p className="text-xs text-text-faint">
                      {DATE.format(event.startTime)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ProjectForm
        action={updateProjectAction.bind(null, project.id)}
        submitLabel="Save changes"
        goals={goals}
        initial={{
          title: project.title,
          category: project.category as ProjectCategory,
          goalId: project.goalId,
        }}
      />

      <div className="mt-3 border-t border-border-subtle pt-3">
        <ConfirmDeleteButton
          action={deleteProjectAction.bind(null, project.id)}
          label="Delete project"
          confirmText="Delete this project? Its notes, tasks and events will be kept and simply unlinked."
        />
      </div>
    </div>
  );
}
