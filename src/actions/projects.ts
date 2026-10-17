"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as projectService from "@/services/project-service";
import { PROJECT_CATEGORIES } from "@/lib/domain";

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const projectSchema = z.object({
  title: z.string().trim().min(1, "Give the project a name.").max(200),
  category: z.enum(PROJECT_CATEGORIES).default("University"),
  goalId: z.preprocess(emptyToNull, z.uuid().nullable().default(null)),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the project and try again.";
}

function revalidateProjectViews(projectId?: string) {
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/notes");
  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/");
}

export async function createProjectAction(
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = projectSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category") ?? "University",
    goalId: formData.get("goalId") ?? "",
  });
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  try {
    const userId = await requireUserId();
    await projectService.createProject(userId, parsed.data);
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateProjectViews();
  return ok(null);
}

export async function updateProjectAction(
  projectId: string,
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = projectSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category") ?? "University",
    goalId: formData.get("goalId") ?? "",
  });
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  try {
    const userId = await requireUserId();
    await projectService.updateProject(userId, projectId, parsed.data);
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateProjectViews(projectId);
  return ok(null);
}

export async function deleteProjectAction(projectId: string): Promise<void> {
  const userId = await requireUserId();
  await projectService.deleteProject(userId, projectId);

  revalidateProjectViews();
  redirect("/projects");
}
