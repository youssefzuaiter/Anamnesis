import "server-only";
import { AppError } from "@/lib/api-response";
import { dayBounds } from "@/lib/day";
import { busyFrom } from "@/lib/day-planner";
import {
  EXAM_PREP_TAG,
  planExamPrep,
  sessionDescription,
  sessionTitle,
  sessionsNeeded,
  type PrepProblem,
  type PrepSession,
} from "@/lib/exam-prep";
import * as courseRepository from "@/repositories/course-repository";
import * as eventRepository from "@/repositories/event-repository";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import * as taskRepository from "@/repositories/task-repository";
import { createTask } from "@/services/task-service";

/** How many of the course's notes are named in the proposal and in each session's description. */
const NOTES_SHOWN = 5;

export type PrepRequest = {
  assessmentId: string;
  hours: number;
  sessionMinutes: number;
};

export type PrepProposal = {
  assessment: {
    id: string;
    title: string;
    dueDate: Date;
    courseId: string;
    courseCode: string;
  };
  /** Sessions already made for this assessment and not deleted. */
  planned: { count: number; minutes: number };
  /** How many more the chosen review time calls for. */
  requested: number;
  /** `planned.count + requested`: the "of N" in each session's title. */
  total: number;
  sessionMinutes: number;
  windowDays: number;
  /** `index` is the number the session will carry, counting the ones already planned. */
  sessions: (PrepSession & { index: number })[];
  noGapDays: Date[];
  notes: { id: string; title: string }[];
  noteCount: number;
  dueCards: number;
  problem: PrepProblem;
};

/**
 * What a plan for one assessment would look like. Writes nothing: the person
 * confirms first, the same shape Plan my day uses. Only this account's own
 * assessment, events, tasks, notes and cards are read.
 */
export async function proposePrep(
  userId: string,
  request: PrepRequest,
  now: Date = new Date(),
): Promise<PrepProposal> {
  const assessment = await courseRepository.getAssessment(userId, request.assessmentId);
  if (!assessment) {
    throw new AppError("RESOURCE_NOT_FOUND", "That assessment no longer exists.");
  }
  const due = assessment.dueDate;
  if (assessment.score !== null || !due || due <= now) {
    throw new AppError(
      "VALIDATION_ERROR",
      "There is nothing to plan towards: that assessment is graded, has no date, or is already past.",
    );
  }

  // Tomorrow up to the day before the assessment: the days a session can go on.
  const from = dayBounds(now).to;
  const to = dayBounds(due).from;
  const [events, scheduled, existing, notes, dueCards] = await Promise.all([
    eventRepository.listEventsInRange(userId, from, to),
    taskRepository.listScheduledInRange(userId, from, to),
    taskRepository.listPrepSessions(userId, assessment.id),
    courseRepository.listCourseNoteTitles(userId, assessment.course.id, NOTES_SHOWN),
    flashcardRepository.countDueForCourse(userId, assessment.course.id, now),
  ]);

  const planned = {
    count: existing.length,
    minutes: existing.reduce((sum, task) => sum + task.estimatedMinutes, 0),
  };
  const requested = sessionsNeeded(request.hours, request.sessionMinutes, planned.minutes);
  const plan = planExamPrep({
    dueDate: due,
    now,
    sessions: requested,
    sessionMinutes: request.sessionMinutes,
    busy: busyFrom(events, scheduled),
  });

  const problem: PrepProblem =
    requested === 0
      ? "fully-planned"
      : plan.windowDays === 0
        ? "no-window"
        : plan.sessions.length === 0
          ? "nothing-fits"
          : "none";

  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      dueDate: due,
      courseId: assessment.course.id,
      courseCode: assessment.course.code,
    },
    planned,
    requested,
    total: planned.count + requested,
    sessionMinutes: request.sessionMinutes,
    windowDays: plan.windowDays,
    sessions: plan.sessions.map((session, i) => ({ ...session, index: planned.count + i + 1 })),
    noGapDays: plan.noGapDays,
    notes: notes.notes,
    noteCount: notes.total,
    dueCards,
    problem,
  };
}

/**
 * Makes a task for each requested session. Re-derives the plan rather than
 * trusting the times sent back: they went through the browser, so they are
 * client input. A time the server did not itself propose (an invented one, one
 * a first confirmation already took, one that no longer fits) is simply not in
 * the plan and is ignored; if none are left, nothing is made and the person is
 * told to propose again.
 *
 * The sessions are made one after another, not in a transaction: a failure part
 * way leaves the earlier ones in place, and the next proposal counts them as
 * already planned.
 */
export async function applyPrep(
  userId: string,
  request: PrepRequest,
  starts: number[],
  now: Date = new Date(),
): Promise<{ added: number; skipped: number; courseId: string }> {
  const proposal = await proposePrep(userId, request, now);
  const wanted = new Set(starts);
  const keeping = proposal.sessions.filter((session) => wanted.has(session.start.getTime()));

  if (keeping.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Those sessions no longer fit. Propose a plan again.");
  }

  const { assessment } = proposal;
  const description = sessionDescription({
    assessment: assessment.title,
    courseCode: assessment.courseCode,
    dueDate: assessment.dueDate,
    notes: proposal.notes.map((note) => note.title),
    noteCount: proposal.noteCount,
    dueCards: proposal.dueCards,
  });

  for (const session of keeping) {
    // Owed by the end of its own day, the rule every date entered as yyyy-mm-dd follows.
    const dueDate = new Date(session.start);
    dueDate.setHours(23, 59, 59, 999);
    await createTask(userId, {
      title: sessionTitle(assessment.title, session.index, proposal.total),
      description,
      priority: "medium",
      tags: [EXAM_PREP_TAG],
      dueDate,
      estimatedMinutes: request.sessionMinutes,
      projectId: null,
      courseId: assessment.courseId,
      goalId: null,
      assessmentId: assessment.id,
      scheduledStart: session.start,
      scheduledEnd: session.end,
    });
  }
  return {
    added: keeping.length,
    // Ticked in the browser but not in the server's own plan: told to the person, not made.
    skipped: wanted.size - keeping.length,
    courseId: assessment.courseId,
  };
}
