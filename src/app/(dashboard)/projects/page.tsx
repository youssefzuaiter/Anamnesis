import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listProjects } from "@/repositories/project-repository";
import { listGoalOptions } from "@/repositories/goal-repository";
import { ProjectForm } from "@/components/project-form";
import { createProjectAction } from "@/actions/projects";

export const metadata = { title: "Projects · Anamnesis" };

export default async function ProjectsPage() {
  const userId = await requireUserId();
  const [projects, goals] = await Promise.all([
    listProjects(userId),
    listGoalOptions(userId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Projects
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </p>
      </header>

      <ProjectForm
        action={createProjectAction}
        submitLabel="Create project"
        goals={goals}
        resetOnSuccess
      />

      {projects.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-muted">
          No projects yet. Create one to group notes, tasks and events.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="block rounded-xl border border-border-subtle bg-surface p-4 shadow-card transition-colors hover:border-border-strong"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="truncate font-semibold text-text">
                    {project.title}
                  </h2>
                  <span className="shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-text-muted">
                    {project.category}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-3">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-subtle"
                    role="progressbar"
                    aria-valuenow={project.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${project.title} progress`}
                  >
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {project.progress}%
                  </span>
                </div>

                <p className="mt-2 text-xs text-text-muted">
                  {project.counts.notes} notes · {project.counts.openTasks} open
                  of {project.counts.tasks} tasks · {project.counts.events} events
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
