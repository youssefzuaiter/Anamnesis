import type { ProjectOption } from "@/lib/domain";

export function ProjectSelect({
  projects,
  defaultValue,
}: {
  projects: ProjectOption[];
  defaultValue?: string | null;
}) {
  if (projects.length === 0) return null;

  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      Project
      <select
        name="projectId"
        defaultValue={defaultValue ?? ""}
        aria-label="Project"
        className="rounded-lg border border-control bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
      >
        <option value="">No project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.title}
          </option>
        ))}
      </select>
    </label>
  );
}
