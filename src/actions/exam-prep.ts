"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { PREP_HOURS, SESSION_MINUTES, prepNotices } from "@/lib/exam-prep";
import { dateLabel } from "@/lib/note-templates";
import * as examPrepService from "@/services/exam-prep-service";
import type { PrepProposal } from "@/services/exam-prep-service";

export type PrepSessionView = {
  /** The session's start as epoch milliseconds: sent back to confirm it, and only compared there. */
  start: number;
  /** `Fri 30 Oct`. */
  day: string;
  /** `09:00–10:00`. */
  time: string;
  /** `Session 3 of 6`. */
  label: string;
  minutes: number;
};

export type PrepProposalView = {
  assessmentId: string;
  title: string;
  dueLabel: string;
  sessionMinutes: number;
  plannedCount: number;
  plannedHours: number;
  requested: number;
  windowDays: number;
  sessions: PrepSessionView[];
  /** Why there is nothing to propose, or null when there is. */
  message: string | null;
  /** Set when some, but not all, of the sessions fit. */
  shortfall: string | null;
  notes: { id: string; title: string }[];
  noteCount: number;
  dueCards: number;
};

const request = z.object({
  assessmentId: z.uuid(),
  hours: z.literal(PREP_HOURS),
  sessionMinutes: z.literal(SESSION_MINUTES),
});

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function view(proposal: PrepProposal): PrepProposalView {
  const { assessment, planned, sessionMinutes } = proposal;
  const dueLabel = dateLabel(assessment.dueDate);
  const plannedHours = Math.round((planned.minutes / 60) * 10) / 10;

  const { message, shortfall } = prepNotices({
    problem: proposal.problem,
    title: assessment.title,
    dueLabel,
    sessionMinutes,
    plannedCount: planned.count,
    plannedHours,
    placed: proposal.sessions.length,
    requested: proposal.requested,
    windowDays: proposal.windowDays,
    noGapLabels: proposal.noGapDays.map(dateLabel),
  });

  return {
    assessmentId: assessment.id,
    title: assessment.title,
    dueLabel,
    sessionMinutes,
    plannedCount: planned.count,
    plannedHours,
    requested: proposal.requested,
    windowDays: proposal.windowDays,
    sessions: proposal.sessions.map((session) => ({
      start: session.start.getTime(),
      day: dateLabel(session.start),
      time: `${TIME.format(session.start)}–${TIME.format(session.end)}`,
      label: `Session ${session.index} of ${proposal.total}`,
      minutes: sessionMinutes,
    })),
    message,
    shortfall,
    notes: proposal.notes,
    noteCount: proposal.noteCount,
    dueCards: proposal.dueCards,
  };
}

export async function proposePrepAction(input: {
  assessmentId: string;
  hours: number;
  sessionMinutes: number;
}): Promise<ApiResponse<PrepProposalView>> {
  const parsed = request.safeParse(input);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Choose an assessment, a review time and a session length.");

  try {
    const userId = await requireUserId();
    const proposal = await examPrepService.proposePrep(userId, parsed.data, new Date());
    return ok(view(proposal));
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function applyPrepAction(input: {
  assessmentId: string;
  hours: number;
  sessionMinutes: number;
  starts: number[];
}): Promise<ApiResponse<{ added: number; skipped: number }>> {
  const parsed = request
    .extend({ starts: z.array(z.number().int()).min(1).max(40) })
    .safeParse(input);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Nothing to add.");

  try {
    const userId = await requireUserId();
    const { starts, ...chosen } = parsed.data;
    const { added, skipped, courseId } = await examPrepService.applyPrep(userId, chosen, starts, new Date());

    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    revalidatePath(`/courses/${courseId}`);
    return ok({ added, skipped });
  } catch (error) {
    return toApiResponse(error);
  }
}
