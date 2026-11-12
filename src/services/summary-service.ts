import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { proposalSchema, type ActionProposal } from "@/lib/ai-tools";
import { completeJson, type ChatMessage } from "@/lib/ollama";
import { GROUNDED_FLOOR, keepGrounded, sections, summaryNote } from "@/lib/summary";
import { overviewMessages, pointsMessages } from "@/lib/summary-prompts";
import { getNote } from "@/repositories/note-repository";

/*
 * Summarise a note into a new one (ROADMAP 24). Read in sections, each section's points kept only if
 * its own words back them, the overview written from the kept points alone; the result is a `note`
 * proposal the person reads in full and confirms through the same audited path as any other.
 */

type Complete = (messages: ChatMessage[], schema: object) => Promise<unknown>;

/** Every section and the overview fit easily; Ollama's default context is far smaller. */
const CONTEXT_TOKENS = 8_192;

const POINTS = z.object({ points: z.array(z.string().trim().min(10).max(240)).min(1).max(4) });
const OVERVIEW = z.object({ overview: z.string().trim().min(1).max(700) });
const POINTS_SCHEMA = {
  type: "object",
  properties: { points: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 } },
  required: ["points"],
};
const OVERVIEW_SCHEMA = { type: "object", properties: { overview: { type: "string" } }, required: ["overview"] };

const defaultComplete: Complete = (messages, schema) => completeJson(messages, schema, CONTEXT_TOKENS);

export type SummaryResult = { proposal: ActionProposal; sections: number; kept: number; dropped: number };

export async function summariseNote(
  userId: string,
  noteId: string,
  deps: { complete?: Complete; now?: Date; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<SummaryResult> {
  const note = z.uuid().safeParse(noteId).success ? await getNote(userId, noteId) : null;
  if (!note) throw new AppError("RESOURCE_NOT_FOUND", "That note does not exist.");
  const parts = sections(note.content);
  if (parts.length === 0) throw new AppError("VALIDATION_ERROR", "This note is empty; there is nothing to summarise.");

  const complete = deps.complete ?? defaultComplete;
  const points: string[] = [];
  let dropped = 0;
  for (const [index, part] of parts.entries()) {
    // The person left: stop calling the model for a summary nobody will see.
    if (deps.signal?.aborted) throw new AppError("VALIDATION_ERROR", "The summary was stopped.");
    const answer = POINTS.safeParse(await complete(pointsMessages(part), POINTS_SCHEMA));
    // An answer outside the schema costs that section, not the summary.
    if (answer.success) {
      const checked = keepGrounded(answer.data.points, part, GROUNDED_FLOOR);
      points.push(...checked.kept);
      dropped += checked.dropped.length;
    }
    deps.onProgress?.(index + 1, parts.length);
  }
  if (points.length === 0) {
    throw new AppError("AI_OUTPUT_INVALID", "The model could not find points in this note that it could back up from the note's own words.");
  }

  const overview = OVERVIEW.safeParse(await complete(overviewMessages(points), OVERVIEW_SCHEMA));
  if (!overview.success) throw new AppError("AI_OUTPUT_INVALID", "The model did not write a usable overview. Try again.");

  const { title, content } = summaryNote(note.title, overview.data.overview, points, deps.now ?? new Date());
  const proposal = proposalSchema.parse({ kind: "note", title, content });
  return { proposal, sections: parts.length, kept: points.length, dropped };
}
