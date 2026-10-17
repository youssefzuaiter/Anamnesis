"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as goalService from "@/services/goal-service";
import { PROJECT_CATEGORIES } from "@/lib/domain";

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const goalSchema = z.object({
  title: z.string().trim().min(1, "Give the goal a name.").max(200),
  description: z.preprocess(
    emptyToNull,
    z.string().trim().max(5000).nullable().default(null),
  ),
  category: z.enum(PROJECT_CATEGORIES).default("University"),
  targetDate: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
      .nullable()
      .default(null),
  ),
});

// A bare yyyy-mm-dd parses as UTC midnight, which lands on the previous day
// for anyone behind UTC — the same reason task due dates are pinned this way
// in actions/tasks.ts.
function endOfLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the goal and try again.";
}

function revalidateGoalViews(goalId?: string) {
  revalidatePath("/goals");
  if (goalId) revalidatePath(`/goals/${goalId}`);
  revalidatePath("/projects");
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function createGoalAction(
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = goalSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    category: formData.get("category") ?? "University",
    targetDate: formData.get("targetDate") ?? "",
  });
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  try {
    const userId = await requireUserId();
    await goalService.createGoal(userId, {
      ...parsed.data,
      targetDate: parsed.data.targetDate
        ? endOfLocalDay(parsed.data.targetDate)
        : null,
    });
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateGoalViews();
  return ok(null);
}

export async function updateGoalAction(
  goalId: string,
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = goalSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    category: formData.get("category") ?? "University",
    targetDate: formData.get("targetDate") ?? "",
  });
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  try {
    const userId = await requireUserId();
    await goalService.updateGoal(userId, goalId, {
      ...parsed.data,
      targetDate: parsed.data.targetDate
        ? endOfLocalDay(parsed.data.targetDate)
        : null,
    });
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateGoalViews(goalId);
  return ok(null);
}

export async function deleteGoalAction(goalId: string): Promise<void> {
  const userId = await requireUserId();
  await goalService.deleteGoal(userId, goalId);

  revalidateGoalViews();
  redirect("/goals");
}
