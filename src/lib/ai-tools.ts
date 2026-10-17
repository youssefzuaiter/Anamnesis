import { z } from "zod";
import {
  PROJECT_CATEGORIES,
  TASK_PRIORITIES,
  type ProjectCategory,
} from "@/lib/domain";

// The complete set of things the assistant may ever ask for. Anything not named
// here cannot be requested, so widening the agent's reach is a deliberate edit to
// this list rather than an emergent property of a prompt.
//
// Deliberately create-only: nothing here can update or delete, so the worst a
// fully hijacked model can achieve is proposing clutter the user then declines.
export const AI_TOOLS = [
  "create_task",
  "create_event",
  "create_note",
  "create_goal",
] as const;
export type AiTool = (typeof AI_TOOLS)[number];

const isoDate = z.iso.datetime();

export const proposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    title: z.string().trim().min(1).max(200),
    dueDate: isoDate.nullable().default(null),
    priority: z.enum(TASK_PRIORITIES).default("medium"),
    estimatedMinutes: z.coerce.number().int().min(1).max(60 * 24).default(60),
  }),
  z.object({
    kind: z.literal("event"),
    title: z.string().trim().min(1).max(200),
    startTime: isoDate,
    endTime: isoDate,
    location: z.string().trim().max(200).nullable().default(null),
  }),
  z.object({
    kind: z.literal("note"),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(100_000).default(""),
  }),
  // No target date: a goal is named, not scheduled, and a 3B model is no better
  // at "by June" than it is at "next Friday". The user sets one on the goal page
  // after confirming, the same way they would for any goal made by hand.
  z.object({
    kind: z.literal("goal"),
    title: z.string().trim().min(1).max(200),
    category: z.enum(PROJECT_CATEGORIES).default("University"),
  }),
]);

export type ActionProposal = z.infer<typeof proposalSchema>;

/** A proposal as it travels to the browser and back, carrying its own identity. */
export const pendingProposalSchema = z.object({
  proposalId: z.uuid(),
  proposal: proposalSchema,
});

export type PendingProposal = z.infer<typeof pendingProposalSchema>;

/** Tool definitions in the shape Ollama expects. */
export const OLLAMA_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Propose a new task for the user to confirm. Use when they ask you to add, remind or track something they must do.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short description of the task" },
          dueDate: {
            type: "string",
            description: "ISO 8601 date-time, or omit if no due date was given",
          },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          estimatedMinutes: { type: "integer" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_event",
      description:
        "Propose a new calendar event for the user to confirm. Use when they ask you to schedule or book something at a time.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          startTime: { type: "string", description: "ISO 8601 date-time" },
          endTime: { type: "string", description: "ISO 8601 date-time" },
          location: { type: "string" },
        },
        required: ["title", "startTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_note",
      description:
        "Propose a new note for the user to confirm. Use when they ask you to write down or remember a piece of information.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  // Deliberately terse. A longer description that spelled out "a single thing to
  // do is a task, not a goal" scored no better on goal routing (10/10 either
  // way) and proposed a goal for "I need to set up my thesis proposal this
  // week", one of 8 "set …" requests that are really tasks, events or notes;
  // this wording proposed none of the 8. It also keeps "Add three tasks: …" at
  // the one proposal it gave before this tool existed.
  {
    type: "function",
    function: {
      name: "create_goal",
      description:
        "Propose a new long-term goal for the user to confirm. Use only when they explicitly ask you to set or add a goal or objective.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The goal, in the user's own words" },
          category: { type: "string", enum: ["University", "Career", "Personal"] },
        },
        required: ["title"],
      },
    },
  },
] as const;

const DEFAULT_EVENT_MINUTES = 60;
const DEFAULT_TASK_MINUTES = 60;

// A model that was not given a duration sometimes fills the field with 0 rather
// than omitting it. 0 fails the schema's min(1) and would silently drop the
// whole proposal, so it is repaired to the default here rather than rejected —
// the user still sees and confirms the result, same as the event end time below.
function normalizedMinutes(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 1
    ? n
    : DEFAULT_TASK_MINUTES;
}

// A model asked to pick from three words will still sometimes hand back "career"
// or "Career goal". Matching case-insensitively and falling back to the default
// repairs that, rather than letting the enum reject — and silently drop — a
// proposal whose title was perfectly good. The user sees the category on the
// card before confirming, so a wrong guess costs a decline, not bad data.
function normalizedCategory(value: unknown): ProjectCategory {
  if (typeof value === "string") {
    const wanted = value.trim().toLowerCase();
    const match = PROJECT_CATEGORIES.find((c) => c.toLowerCase() === wanted);
    if (match) return match;
  }
  return "University";
}

/**
 * Converts a raw tool call into a validated proposal, or null if the model asked
 * for an unknown tool or supplied arguments that do not survive validation. The
 * model's output is never trusted far enough to reach the database.
 */
export function toProposal(
  name: string,
  args: Record<string, unknown>,
): ActionProposal | null {
  if (!AI_TOOLS.includes(name as AiTool)) return null;

  if (name === "create_task") {
    const result = proposalSchema.safeParse({
      kind: "task",
      title: args.title,
      dueDate: args.dueDate ?? null,
      priority: args.priority ?? "medium",
      estimatedMinutes: normalizedMinutes(args.estimatedMinutes),
    });
    return result.success ? result.data : null;
  }

  if (name === "create_event") {
    const start =
      typeof args.startTime === "string" ? Date.parse(args.startTime) : NaN;
    if (Number.isNaN(start)) return null;

    const parsedEnd =
      typeof args.endTime === "string" ? Date.parse(args.endTime) : NaN;
    // An end that is missing, unparseable, or not after the start is repaired
    // rather than rejected: the user still sees and confirms the result.
    const end =
      Number.isNaN(parsedEnd) || parsedEnd <= start
        ? start + DEFAULT_EVENT_MINUTES * 60_000
        : parsedEnd;

    const result = proposalSchema.safeParse({
      kind: "event",
      title: args.title,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      location: args.location ?? null,
    });
    return result.success ? result.data : null;
  }

  if (name === "create_goal") {
    const result = proposalSchema.safeParse({
      kind: "goal",
      title: args.title,
      category: normalizedCategory(args.category),
    });
    return result.success ? result.data : null;
  }

  const result = proposalSchema.safeParse({
    kind: "note",
    title: args.title,
    content: args.content ?? "",
  });
  return result.success ? result.data : null;
}
