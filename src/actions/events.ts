"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import * as eventService from "@/services/event-service";
import { NOT_A_TIME, epochMs } from "@/lib/epoch-ms";
import {
  RECURRENCE_FREQUENCIES,
  MAX_RECURRENCE_COUNT,
  DEFAULT_RECURRENCE_COUNT,
} from "@/lib/recurrence";

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const eventSchema = z.object({
  title: z.string().trim().min(1, "Give the event a title.").max(200),
  description: z.preprocess(
    emptyToNull,
    z.string().trim().max(5000).nullable().default(null),
  ),
  location: z.preprocess(
    emptyToNull,
    z.string().trim().max(200).nullable().default(null),
  ),
  startTime: z
    .string()
    .regex(LOCAL_DATETIME, "Pick a start date and time."),
  endTime: z.string().regex(LOCAL_DATETIME, "Pick an end date and time."),
  projectId: z.preprocess(
    emptyToNull,
    z.uuid().nullable().default(null),
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

// datetime-local has no timezone, and it means local wall-clock time. Building
// the Date from parts keeps it local; new Date("...") would read it as UTC.
function fromLocalInput(value: string): Date {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function parseForm(formData: FormData) {
  const parsed = eventSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    location: formData.get("location") ?? "",
    startTime: formData.get("startTime") ?? "",
    endTime: formData.get("endTime") ?? "",
    projectId: formData.get("projectId") ?? "",
    recurrenceFrequency: formData.get("recurrenceFrequency") ?? "",
    recurrenceCount: formData.get("recurrenceCount") ?? null,
  });

  if (!parsed.success) return parsed;

  return {
    success: true as const,
    data: {
      ...parsed.data,
      startTime: fromLocalInput(parsed.data.startTime),
      endTime: fromLocalInput(parsed.data.endTime),
    },
  };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the event and try again.";
}

function revalidateCalendar(eventId?: string) {
  revalidatePath("/calendar");
  if (eventId) revalidatePath(`/calendar/${eventId}`);
  revalidatePath("/projects");
  revalidatePath("/");
}

export async function createEventAction(
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = parseForm(formData);
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  const { recurrenceFrequency, recurrenceCount, ...eventInput } = parsed.data;

  try {
    const userId = await requireUserId();
    if (recurrenceFrequency) {
      await eventService.createRecurringEvents(
        userId,
        eventInput,
        recurrenceFrequency,
        recurrenceCount ?? DEFAULT_RECURRENCE_COUNT,
      );
    } else {
      await eventService.createEvent(userId, eventInput);
    }
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateCalendar();
  return ok(null);
}

export async function updateEventAction(
  eventId: string,
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsed = parseForm(formData);
  if (!parsed.success) return fail("VALIDATION_ERROR", firstIssue(parsed.error));

  // Recurrence is offered only at creation — editing one occurrence never
  // turns it into (or updates) a series, so only the plain event fields
  // are forwarded here.
  const { title, description, location, startTime, endTime, projectId } = parsed.data;

  try {
    const userId = await requireUserId();
    await eventService.updateEvent(userId, eventId, {
      title,
      description,
      location,
      startTime,
      endTime,
      projectId,
    });
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateCalendar(eventId);
  return ok(null);
}

const moveEventSchema = z.object({ eventId: z.uuid(), startMs: epochMs, endMs: epochMs });

/**
 * Called directly from the hourly grid (a drag, or a button of the selection bar), not through a form: moves or
 * resizes an event, changing only its two times. The numbers came from the browser, so they are checked here
 * before anything else, then again, with the same rule, by the service.
 */
export async function moveEventAction(
  eventId: string,
  startMs: number,
  endMs: number,
): Promise<ApiResponse<null>> {
  const parsed = moveEventSchema.safeParse({ eventId, startMs, endMs });
  if (!parsed.success) return fail("VALIDATION_ERROR", NOT_A_TIME);

  try {
    const userId = await requireUserId();
    await eventService.rescheduleEvent(userId, parsed.data.eventId, new Date(parsed.data.startMs), new Date(parsed.data.endMs));
  } catch (error) {
    return toApiResponse(error);
  }

  revalidateCalendar(eventId);
  return ok(null);
}

export async function deleteEventAction(eventId: string): Promise<void> {
  const userId = await requireUserId();
  await eventService.deleteEvent(userId, eventId);

  revalidateCalendar();
  redirect("/calendar");
}

export async function deleteEventSeriesAction(eventId: string): Promise<void> {
  const userId = await requireUserId();
  await eventService.deleteEventSeriesFrom(userId, eventId);

  revalidateCalendar();
  redirect("/calendar");
}
