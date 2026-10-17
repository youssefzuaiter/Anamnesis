"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { TASK_PRIORITIES } from "@/lib/domain";
import * as taskService from "@/services/task-service";
import * as eventService from "@/services/event-service";
import * as noteService from "@/services/note-service";

const isoDate = z.iso.datetime();

// The confirmed proposal is re-validated from scratch. It reaches us through the
// browser, so it is client input by the time we see it, whatever produced it.
const proposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    title: z.string().trim().min(1).max(200),
    dueDate: isoDate.nullable(),
    priority: z.enum(TASK_PRIORITIES),
    estimatedMinutes: z.coerce.number().int().min(1).max(60 * 24),
  }),
  z.object({
    kind: z.literal("event"),
    title: z.string().trim().min(1).max(200),
    startTime: isoDate,
    endTime: isoDate,
    location: z.string().trim().max(200).nullable(),
  }),
  z.object({
    kind: z.literal("note"),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(100_000),
  }),
]);

export async function confirmCaptureAction(
  raw: unknown,
): Promise<ApiResponse<{ href: string }>> {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "That capture is no longer valid.");
  }

  try {
    const userId = await requireUserId();
    const proposal = parsed.data;

    if (proposal.kind === "task") {
      const task = await taskService.createTask(userId, {
        title: proposal.title,
        description: null,
        priority: proposal.priority,
        tags: [],
        courseId: null,
        goalId: null,
        dueDate: proposal.dueDate ? new Date(proposal.dueDate) : null,
        estimatedMinutes: proposal.estimatedMinutes,
        projectId: null,
        scheduledStart: null,
        scheduledEnd: null,
      });
      revalidatePath("/tasks");
      revalidatePath("/");
      return ok({ href: `/tasks/${task.id}` });
    }

    if (proposal.kind === "event") {
      const event = await eventService.createEvent(userId, {
        title: proposal.title,
        description: null,
        startTime: new Date(proposal.startTime),
        endTime: new Date(proposal.endTime),
        location: proposal.location,
        projectId: null,
      });
      revalidatePath("/calendar");
      revalidatePath("/");
      return ok({ href: `/calendar/${event.id}` });
    }

    const note = await noteService.createNote(userId, {
      title: proposal.title,
      content: proposal.content,
      tags: [],
      isFavorite: false,
      projectId: null,
      courseId: null,
    });
    revalidatePath("/notes");
    revalidatePath("/");
    return ok({ href: `/notes/${note.id}` });
  } catch (error) {
    return toApiResponse(error);
  }
}
