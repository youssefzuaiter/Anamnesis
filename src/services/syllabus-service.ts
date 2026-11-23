import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { completeJson, type ChatMessage } from "@/lib/ollama";
import { sections } from "@/lib/summary";
import {
  MAX_SYLLABUS_SECTIONS, buildRows, endOfLocalDay, extractedSchema, markExisting, mergeRows, termYear,
  type ConfirmRow, type SyllabusRow,
} from "@/lib/syllabus";
import { assessmentMessages } from "@/lib/syllabus-prompts";
import * as courseRepository from "@/repositories/course-repository";
import * as noteRepository from "@/repositories/note-repository";
import { indexCourse } from "@/services/course-service";
import { assertNotLocked } from "@/services/note-lock-service";

/*
 * Syllabus to assessments (ROADMAP 50): a note is read in sections, the model lists what looks like an assessment with the line it came from, and
 * the rules in `lib/syllabus.ts` hold every row to the note. The result is a proposal and nothing is written; `addAssessments` writes what the
 * person confirmed, all or none.
 */

type Complete = (messages: ChatMessage[], schema: object) => Promise<unknown>;

const CONTEXT_TOKENS = 8_192;
const ITEMS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          weight: { type: ["number", "null"] },
          quote: { type: "string" },
        },
        required: ["title", "weight", "quote"],
      },
    },
  },
  required: ["items"],
};

const defaultComplete: Complete = (messages, schema) => completeJson(messages, schema, CONTEXT_TOKENS);

export type AssessmentProposal = {
  noteTitle: string;
  rows: (SyllabusRow & { existing: boolean })[];
  sections: number;
};

export async function proposeAssessments(
  userId: string,
  courseId: string,
  noteId: string,
  deps: { complete?: Complete; now?: Date } = {},
): Promise<AssessmentProposal> {
  const course = z.uuid().safeParse(courseId).success ? await courseRepository.getCourse(userId, courseId) : null;
  if (!course) throw new AppError("RESOURCE_NOT_FOUND", "That course no longer exists.");
  const note = z.uuid().safeParse(noteId).success ? await noteRepository.getNote(userId, noteId) : null;
  if (!note) throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");
  assertNotLocked(note);
  const parts = sections(note.content).slice(0, MAX_SYLLABUS_SECTIONS);
  if (parts.length === 0) throw new AppError("VALIDATION_ERROR", "This note is empty; there is nothing to read.");

  const complete = deps.complete ?? defaultComplete;
  const term = termYear(course.term);
  const now = deps.now ?? new Date();
  const groups: SyllabusRow[][] = [];
  let usable = 0;
  for (const part of parts) {
    const answer = extractedSchema.safeParse(await complete(assessmentMessages(part), ITEMS_SCHEMA));
    // An answer outside the schema costs that section, not the proposal.
    if (!answer.success) continue;
    usable += 1;
    groups.push(buildRows(answer.data.items, part, term, now));
  }
  if (usable === 0) throw new AppError("AI_OUTPUT_INVALID", "The model could not read assessments from this note. Add them by hand.");

  const existing = await courseRepository.listAssessmentTitles(userId, courseId);
  return { noteTitle: note.title, rows: markExisting(mergeRows(groups), existing), sections: parts.length };
}

/** Adds the confirmed rows to the caller's own course, all or none, and refreshes the course in the search index once. */
export async function addAssessments(userId: string, courseId: string, rows: ConfirmRow[]): Promise<{ created: number }> {
  const course = await courseRepository.getCourse(userId, courseId);
  if (!course) throw new AppError("RESOURCE_NOT_FOUND", "That course no longer exists.");
  const created = await courseRepository.createAssessments(
    userId,
    courseId,
    rows.map((row) => ({ title: row.title, weight: row.weight, dueDate: row.dueDate ? endOfLocalDay(row.dueDate) : null })),
  );
  await indexCourse(userId, courseId);
  return { created };
}
