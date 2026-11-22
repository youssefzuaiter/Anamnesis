import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { completeJson, type ChatMessage } from "@/lib/ollama";
import { sections } from "@/lib/summary";
import {
  MAX_ROWS, buildRows, detectCourse, extractByCode, extractedSchema, markDuplicates, postText,
  type ConfirmRow, type ExtractedItem, type PostRow,
} from "@/lib/post-intake";
import { postMessages } from "@/lib/post-prompts";
import { endOfLocalDay } from "@/lib/syllabus";
import { isoDay } from "@/lib/week-planner";
import * as courseRepository from "@/repositories/course-repository";
import * as taskRepository from "@/repositories/task-repository";
import { createTask } from "@/services/task-service";

/*
 * Assignments from a pasted post (ROADMAP 55): the assistant (or, with it off, rules) picks out the sentences that set work; `lib/post-intake.ts`
 * holds each to the post and reads its date by code. The result is a proposal and nothing is written; `addTasksFromPost` writes what was confirmed.
 */

type Complete = (messages: ChatMessage[], schema: object) => Promise<unknown>;

const CONTEXT_TOKENS = 8_192;
const MAX_SECTIONS = 2;
const ITEMS_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object", properties: { title: { type: "string" }, quote: { type: "string" } }, required: ["title", "quote"] } },
  },
  required: ["items"],
};
const defaultComplete: Complete = (messages, schema) => completeJson(messages, schema, CONTEXT_TOKENS);

export type PostProposal = {
  rows: (PostRow & { existing: boolean })[];
  courseId: string | null;
  engine: "model" | "rules";
};

export async function proposeFromPost(
  userId: string,
  rawText: string,
  courseId: string | null,
  deps: { complete?: Complete; now?: Date; engine?: string } = {},
): Promise<PostProposal> {
  const text = postText(rawText);
  if (text === "") throw new AppError("VALIDATION_ERROR", "Paste the teacher's post first.");
  if (courseId !== null && !(await courseRepository.getCourse(userId, courseId))) {
    throw new AppError("RESOURCE_NOT_FOUND", "That course no longer exists.");
  }
  const now = deps.now ?? new Date();
  const complete = deps.complete ?? defaultComplete;

  let items: ExtractedItem[] = [];
  let engine: "model" | "rules" = "rules";
  if ((deps.engine ?? process.env.POST_INTAKE_ENGINE) !== "code") {
    for (const part of sections(text).slice(0, MAX_SECTIONS)) {
      try {
        const answer = extractedSchema.safeParse(await complete(postMessages(part), ITEMS_SCHEMA));
        if (answer.success) {
          items.push(...answer.data.items);
          engine = "model";
        }
      } catch (error) {
        // The assistant being off or unusable is a fallback, never a refusal; anything else is a real fault.
        if (!(error instanceof AppError) || (error.code !== "AI_UNAVAILABLE" && error.code !== "AI_OUTPUT_INVALID")) throw error;
      }
    }
  }
  if (engine === "rules") items = extractByCode(text, now);

  const rows = buildRows(items.slice(0, MAX_ROWS), text, now);
  const open = await taskRepository.listOpenTaskTitles(userId);
  const existing = open.map((task) => ({ title: task.title, dueDate: task.dueDate ? isoDay(task.dueDate) : null }));
  const detected = courseId ?? detectCourse(text, await courseRepository.listCourseOptions(userId));
  return { rows: markDuplicates(rows, existing), courseId: detected, engine };
}

/** Adds the confirmed rows as the caller's own tasks. Every course is checked as theirs before anything is written. */
export async function addTasksFromPost(userId: string, rows: ConfirmRow[]): Promise<{ created: number }> {
  const courseIds = [...new Set(rows.map((row) => row.courseId).filter((id): id is string => id !== null))];
  for (const id of courseIds) {
    if (!(await courseRepository.getCourse(userId, id))) throw new AppError("RESOURCE_NOT_FOUND", "That course no longer exists.");
  }
  let created = 0;
  for (const row of rows) {
    await createTask(userId, {
      title: row.title,
      description: row.note === "" ? null : row.note,
      priority: "medium",
      tags: ["post"],
      dueDate: row.dueDate ? endOfLocalDay(row.dueDate) : null,
      estimatedMinutes: 60,
      projectId: null,
      courseId: row.courseId,
      goalId: null,
      scheduledStart: null,
      scheduledEnd: null,
    });
    created += 1;
  }
  return { created };
}

export const proposeInput = z.object({ text: z.string().max(20_000), courseId: z.uuid().nullable() }).strict();
