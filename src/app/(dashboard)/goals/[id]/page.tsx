import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import {
  getGoal,
  getGoalContents,
  getGoalTaskTotals,
} from "@/repositories/goal-repository";
import type { ProjectCategory } from "@/lib/domain";
import { GoalForm } from "@/components/goal-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { TaskRow } from "@/components/task-row";
import { updateGoalAction, deleteGoalAction } from "@/actions/goals";

export const metadata = { title: "Goal · Nexus" };

export default async function GoalPage({
  params,
}: PageProps<"/goals/[id]">) {
  const userId = await requireUserId();
  const { id } = await params;

  const goal = await getGoal(userId, id);
  if (!goal) notFound();

  const [{ projects, tasks }, taskTotals] = await Promise.all([
    getGoalContents(userId, id),
    getGoalTaskTotals(userId, id),
  ]);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link
          href="/goals"
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Goals
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          {goal.title}
        </h1>
        {goal.description && (
          <p className="mt-1 text-sm text-text-muted">{goal.description}</p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-valuenow={goal.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Goal progress"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${goal.progress}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-text-muted">
            {goal.progress}%
            {taskTotals.total > 0
              ? ` · ${taskTotals.done}/${taskTotals.total} tasks done across ${
                  projects.length > 0 ? "direct and project" : "direct"
                } tasks`
              : " · no linked work yet"}
          </span>
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-faint">
          Projects · {projects.length}
        </h2>
        {projects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted">
            No projects yet. Link one from the{" "}
            <Link href="/projects" className="text-accent hover:underline">
              Projects
            </Link>{" "}
            page.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
                    {project.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {project.progress}%
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-faint">
          Direct tasks · {tasks.length}
        </h2>
        <p className="mb-2 text-xs text-text-faint">
          Tasks linked straight to this goal, not through a project — for
          goals that don&apos;t need a whole project of their own.
        </p>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted">
            No direct tasks. Assign one from the{" "}
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

      <GoalForm
        action={updateGoalAction.bind(null, goal.id)}
        submitLabel="Save changes"
        initial={{
          title: goal.title,
          description: goal.description,
          category: goal.category as ProjectCategory,
          targetDate: goal.targetDate,
        }}
      />

      <div className="mt-3 border-t border-border-subtle pt-3">
        <ConfirmDeleteButton
          action={deleteGoalAction.bind(null, goal.id)}
          label="Delete goal"
          confirmText="Delete this goal? Its projects and tasks will be kept and simply unlinked."
        />
      </div>
    </div>
  );
}
