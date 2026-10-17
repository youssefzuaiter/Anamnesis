"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as taskService from "@/services/task-service";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/domain";
import {
  RECURRENCE_FREQUENCIES,
  MAX_RECURRENCE_COUNT,
  DEFAULT_RECURRENCE_COUNT,
} from "@/lib/recurrence";

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Matches the note tag limit; the two share a filter UI and a mental model.
const MAX_TAGS = 12;

// datetime-local carries no timezone and means local wall-clock time; building
// the Date from parts keeps it local, where new Date(string) would read it as UTC.
function fromLocalInput(value: string | null): Date | null {
  if (!value) return null;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const taskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  description: z.preprocess(
    emptyToNull,
    z.string().trim().max(5000).nullable().default(null),
  ),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  tags: z
    .string()
    .default("")
    .transform((raw) =>
      [
        ...new Set(
          raw
            .split(",")
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, MAX_TAGS),
    ),
  dueDate: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
      .nullable()
      .default(null),
  ),
  estimatedMinutes: z.coerce
    .number()
    .int()
    .min(1, "Estimate at least a minute.")
    .max(60 * 24)
    .default(60),
  projectId: z.preprocess(
    emptyToNull,
    z.uuid().nullable().default(null),
  ),
  courseId: z.preprocess(
    emptyToNull,
    z.uuid().nullable().default(null),
  ),
  goalId: z.preprocess(
    emptyToNull,
    z.uuid().nullable().default(null),
  ),
  scheduledStart: z.preprocess(
    emptyToNull,
    z.string().regex(LOCAL_DATETIME, "Pick a valid start time.").nullable().default(null),
  ),
  scheduledEnd: z.preprocess(
    emptyToNull,
    z.string().regex(LOCAL_DATETIME, "Pick a valid end time.").nullable().default(null),
  ),
  recurrenceFrequency: z.preprocess(
    emptyToNull,
    z.enum(RECURRENCE_FREQUENCIES).nullable().default(null),
  ),
  recurrenceCount: z.coerce
    .number()
    .int()
    .min(2)
    .max(MAX_RECURRENCE_COUNT)
    .nullable()
    .catch(null),
});


function parseForm(formData: FormData) {
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    priority: formData.get("priority") ?? "medium",
    tags: formData.get("tags") ?? "",
    dueDate: formData.get("dueDate") ?? "",
    estimatedMinutes: formData.get("estimatedMinutes") ?? 60,
    projectId: formData.get("projectId") ?? "",
    courseId: formData.get("courseId") ?? "",
    goalId: formData.get("goalId") ?? "",
    scheduledStart: formData.get("scheduledStart") ?? "",
    scheduledEnd: formData.get("scheduledEnd") ?? "",
    recurrenceFrequency: formData.get("recurrenceFrequency") ?? "",
    recurrenceCount: formData.get("recurrenceCount") ?? null,
  });

  if (!parsed.success) return parsed;

  return {
    success: true as const,
    data: {
      ...parsed.data,
      // A bare yyyy-mm-dd parses as UTC midnight, which lands on the previous
      // day for anyone behind UTC. Pin it to local end-of-day instead.
      dueDate: parsed.data.dueDate ? endOfLocalDay(parsed.data.dueDate) : null,
      scheduledStart: fromLocalInput(parsed.data.scheduledStart),
      scheduledEnd: fromLocalInput(parsed.data.scheduledEnd),
    },
  };
}

function endOfLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the task and try again.";
}

function revalidateTaskViews(taskId?: string) {
  revalidatePath("/tasks");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/projects");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/");
}

export async function createTaskAction(
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = parseForm(formData);
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  const { recurrenceFrequency, recurrenceCount, ...taskInput } = parsed.data;

  try {
    const userId = await requireUserId();
    if (recurrenceFrequency) {
      await taskService.createRecurringTasks(
        userId,
        taskInput,
        recurrenceFrequency,
        recurrenceCount ?? DEFAULT_RECURRENCE_COUNT,
      );
    } else {
      await taskService.createTask(userId, taskInput);
    }
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateTaskViews();
  return ok(null);
}

export async function updateTaskAction(
  taskId: string,
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = parseForm(formData);
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  // Recurrence is offered only at creation — editing one occurrence never
  // turns it into (or updates) a series, so only the plain task fields
  // are forwarded here.
  const {
    title,
    description,
    priority,
    dueDate,
    estimatedMinutes,
    projectId,
    scheduledStart,
    scheduledEnd,
    tags,
    courseId,
    goalId,
  } = parsed.data;

  try {
    const userId = await requireUserId();
    await taskService.updateTask(userId, taskId, {
      title,
      description,
      priority,
      tags,
      courseId,
      goalId,
      dueDate,
      estimatedMinutes,
      projectId,
      scheduledStart,
      scheduledEnd,
    });
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateTaskViews(taskId);
  return ok(null);
}

export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({
      taskId: z.uuid(),
      status: z.enum(TASK_STATUSES),
    })
    .safeParse({
      taskId: formData.get("taskId"),
      status: formData.get("status"),
    });

  if (!parsed.success) return;

  const userId = await requireUserId();
  await taskService.setTaskStatus(userId, parsed.data.taskId, parsed.data.status);
  revalidateTaskViews(parsed.data.taskId);
}

export async function deleteTaskAction(taskId: string): Promise<void> {
  const userId = await requireUserId();
  await taskService.deleteTask(userId, taskId);

  revalidateTaskViews();
  redirect("/tasks");
}

export async function deleteTaskSeriesAction(taskId: string): Promise<void> {
  const userId = await requireUserId();
  await taskService.deleteTaskSeriesFrom(userId, taskId);

  revalidateTaskViews();
  redirect("/tasks");
}

const scheduleDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.");

/**
 * Called directly from the calendar's drag-and-drop handler, not through a
 * form — schedules the task at a default time (09:00 local) on the dropped
 * date. The precise time is still adjustable afterward from the task's own
 * time-block fields.
 */
export async function scheduleTaskAction(
  taskId: string,
  dateStr: string,
): Promise<ApiResponse<null>> {
  const parsed = scheduleDateSchema.safeParse(dateStr);
  if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid date.");

  try {
    const userId = await requireUserId();
    const [year, month, day] = dateStr.split("-").map(Number);
    const scheduledStart = new Date(year, month - 1, day, 9, 0, 0, 0);
    await taskService.scheduleTask(userId, taskId, scheduledStart);
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateTaskViews(taskId);
  return ok(null);
}
