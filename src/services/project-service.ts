import "server-only";
import { prisma } from "@/lib/prisma";
import { indexEntity, deleteEntityEmbeddings } from "@/lib/vector";
import { AppError } from "@/lib/api-response";
import * as projectRepository from "@/repositories/project-repository";
import type { ProjectInput } from "@/repositories/project-repository";
import { assertGoalOwned, recalculateGoalProgress } from "@/services/goal-service";
import { embeddableTextFor, projectTaskSummary } from "@/services/embeddable-text";
import type { ProjectModel as Project } from "@/generated/prisma/models";

async function syncProjectIndex(userId: string, project: Project) {
  const tasks = await prisma.task.findMany({
    where: { userId, projectId: project.id, deletedAt: null },
    select: { title: true, status: true },
  });

  const summary = projectTaskSummary(tasks);

  try {
    await indexEntity(
      userId,
      "project",
      project.id,
      embeddableTextFor.project(project, summary),
    );
  } catch (error) {
    console.error(`[WARN] Failed to index project ${project.id}:`, error);
    await deleteEntityEmbeddings(userId, "project", project.id).catch(() => {});
  }
}

/**
 * A projectId arriving from a form is client-supplied. The database would
 * happily accept another user's project id, so ownership must be checked here
 * before any entity is attached to it.
 */
export async function assertProjectOwned(
  userId: string,
  projectId: string | null,
): Promise<void> {
  if (!projectId) return;

  const project = await projectRepository.getProject(userId, projectId);
  if (!project) {
    throw new AppError("RESOURCE_NOT_FOUND", "That project no longer exists.");
  }
}

/**
 * Progress is derived from linked tasks and written only here, so the stored
 * column can never disagree with the tasks it summarises. Nothing else may
 * write `progress`.
 *
 * Cascades to the project's own goal (if any) at the end, so every existing
 * call site below — every task mutation already calls this — ripples up to
 * Goal.progress for free, with no changes needed in task-service.ts for the
 * "task belongs to a project that belongs to a goal" path. Only a task's
 * *direct* goalId needs its own handling, in task-service.ts.
 */
export async function recalculateProgress(
  userId: string,
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) return;

  const project = await projectRepository.getProject(userId, projectId);
  if (!project) return;

  const tasks = await prisma.task.findMany({
    where: { userId, projectId, deletedAt: null },
    select: { status: true },
  });

  const done = tasks.filter((task) => task.status === "done").length;
  const progress =
    tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);

  if (progress !== project.progress) {
    await projectRepository.setProgress(userId, projectId, progress);
  }

  await syncProjectIndex(userId, { ...project, progress });
  await recalculateGoalProgress(userId, project.goalId);
}

export async function createProject(
  userId: string,
  input: ProjectInput,
): Promise<Project> {
  await assertGoalOwned(userId, input.goalId);
  const project = await projectRepository.createProject(userId, input);
  await syncProjectIndex(userId, project);
  // A brand new project has no tasks yet, so its goal's tally is unaffected
  // either way — but recalculating anyway (rather than skipping, the way
  // this function already skips recalculateProgress on itself) keeps the
  // rule simple: every lifecycle point of an entity that owns a `goalId`
  // recalculates that goal, no exceptions to remember.
  await recalculateGoalProgress(userId, project.goalId);
  return project;
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: ProjectInput,
): Promise<Project> {
  await assertGoalOwned(userId, input.goalId);

  const before = await projectRepository.getProject(userId, projectId);
  const project = await projectRepository.updateProject(
    userId,
    projectId,
    input,
  );
  if (!project) {
    throw new AppError("RESOURCE_NOT_FOUND", "That project no longer exists.");
  }
  await syncProjectIndex(userId, project);

  // Moving a project between goals changes the progress of both, the same
  // before/after handling updateTask already gives projectId.
  await recalculateGoalProgress(userId, before?.goalId);
  if (before?.goalId !== project.goalId) {
    await recalculateGoalProgress(userId, project.goalId);
  }
  return project;
}

/**
 * Soft-deletes the project and detaches its contents rather than cascading.
 * Losing a project must never silently take the user's notes with it.
 */
export async function deleteProject(
  userId: string,
  projectId: string,
): Promise<void> {
  const before = await projectRepository.getProject(userId, projectId);
  const deleted = await projectRepository.softDeleteProject(userId, projectId);
  if (!deleted) {
    throw new AppError("RESOURCE_NOT_FOUND", "That project no longer exists.");
  }

  await prisma.$transaction([
    prisma.note.updateMany({
      where: { userId, projectId },
      data: { projectId: null },
    }),
    prisma.task.updateMany({
      where: { userId, projectId },
      data: { projectId: null },
    }),
    prisma.event.updateMany({
      where: { userId, projectId },
      data: { projectId: null },
    }),
  ]);

  await deleteEntityEmbeddings(userId, "project", projectId);
  // The project's tasks were just detached, so its goal's tally must drop
  // immediately rather than staying stale until something else recalculates it.
  await recalculateGoalProgress(userId, before?.goalId);
}

/**
 * Undoes `deleteProject` as far as it can be undone. Deleting detached the
 * project's notes, tasks and events by nulling their `projectId`, and that
 * association is not recorded anywhere else — so a restored project comes back
 * empty. The UI has to say so rather than implying a full undo.
 */
export async function restoreProject(
  userId: string,
  projectId: string,
): Promise<Project> {
  const project = await projectRepository.restoreProject(userId, projectId);
  if (!project) {
    throw new AppError("RESOURCE_NOT_FOUND", "That project is not in the trash.");
  }

  // Deleting detached the project's tasks but left its stored progress as it
  // was, so a project deleted at 67% would come back claiming 67% of nothing.
  // Recomputing also re-syncs its search index and, through the cascade at the
  // end of recalculateProgress, its goal.
  await recalculateProgress(userId, projectId);
  return (await projectRepository.getProject(userId, projectId)) ?? project;
}

export async function purgeProject(
  userId: string,
  projectId: string,
): Promise<void> {
  const purged = await projectRepository.purgeProject(userId, projectId);
  if (!purged) {
    throw new AppError("RESOURCE_NOT_FOUND", "That project is not in the trash.");
  }
}
