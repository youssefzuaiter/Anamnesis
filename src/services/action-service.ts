import "server-only";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import type { ActionProposal } from "@/lib/ai-tools";
import * as taskService from "@/services/task-service";
import * as eventService from "@/services/event-service";
import * as noteService from "@/services/note-service";
import * as goalService from "@/services/goal-service";

export type ActorType = "USER" | "AI_AGENT" | "SYSTEM";
export type ActionSource = "assistant" | "capture";

export type ExecutedAction = {
  entityType: "Task" | "Event" | "Note" | "Goal";
  entityId: string;
  href: string;
  /** True when an identical confirmation had already been applied. */
  replayed: boolean;
};

const ACTION_NAMES = {
  task: "TASK_CREATED",
  event: "EVENT_CREATED",
  note: "NOTE_CREATED",
  goal: "GOAL_CREATED",
} as const;

const ENTITY_TYPES = {
  task: "Task",
  event: "Event",
  note: "Note",
  goal: "Goal",
} as const;

const HREF_PREFIX = {
  task: "/tasks",
  event: "/calendar",
  note: "/notes",
  goal: "/goals",
} as const;

/**
 * Records that the model asked for something. Written when the proposal is shown,
 * before any confirmation, so the audit trail contains what was requested even if
 * the user declines — which is exactly the case worth being able to review.
 */
export async function recordProposed(
  userId: string,
  proposalId: string,
  proposal: ActionProposal,
  source: ActionSource,
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "AI_AGENT",
      action: "AI_MUTATION_PROPOSED",
      entityType: ENTITY_TYPES[proposal.kind],
      entityId: proposalId,
      metadata: { proposalId, source, proposal },
    },
  });
}

async function findApplied(
  userId: string,
  proposalId: string,
): Promise<ExecutedAction | null> {
  const existing = await prisma.auditEvent.findFirst({
    where: {
      userId,
      action: { in: Object.values(ACTION_NAMES) },
      metadata: { path: ["proposalId"], equals: proposalId },
    },
  });

  if (!existing) return null;

  const kind = existing.entityType.toLowerCase() as keyof typeof HREF_PREFIX;
  return {
    entityType: existing.entityType as ExecutedAction["entityType"],
    entityId: existing.entityId,
    href: `${HREF_PREFIX[kind]}/${existing.entityId}`,
    replayed: true,
  };
}

/**
 * The single point at which an AI-proposed mutation becomes real. Everything that
 * makes it safe lives here rather than in the model's judgement: the userId comes
 * from the session, the proposal is re-validated by the caller before arriving,
 * the same proposalId can only ever apply once, and the result is audited.
 */
export async function executeProposal(
  userId: string,
  proposalId: string,
  proposal: ActionProposal,
  source: ActionSource,
): Promise<ExecutedAction> {
  // A double-clicked confirm, a retried request or a replayed payload must not
  // create the entity twice.
  const alreadyApplied = await findApplied(userId, proposalId);
  if (alreadyApplied) return alreadyApplied;

  let entityId: string;

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
    entityId = task.id;
  } else if (proposal.kind === "event") {
    const start = new Date(proposal.startTime);
    const end = new Date(proposal.endTime);
    if (end <= start) {
      throw new AppError(
        "VALIDATION_ERROR",
        "The event must end after it starts.",
      );
    }
    const event = await eventService.createEvent(userId, {
      title: proposal.title,
      description: null,
      startTime: start,
      endTime: end,
      location: proposal.location,
      projectId: null,
    });
    entityId = event.id;
  } else if (proposal.kind === "goal") {
    const goal = await goalService.createGoal(userId, {
      title: proposal.title,
      description: null,
      category: proposal.category,
      targetDate: null,
    });
    entityId = goal.id;
  } else {
    const note = await noteService.createNote(userId, {
      title: proposal.title,
      content: proposal.content,
      tags: [],
      isFavorite: false,
      projectId: null,
      courseId: null,
    });
    entityId = note.id;
  }

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "AI_AGENT",
      action: ACTION_NAMES[proposal.kind],
      entityType: ENTITY_TYPES[proposal.kind],
      entityId,
      metadata: { proposalId, source, confirmedByUser: true },
    },
  });

  return {
    entityType: ENTITY_TYPES[proposal.kind],
    entityId,
    href: `${HREF_PREFIX[proposal.kind]}/${entityId}`,
    replayed: false,
  };
}

export async function recordDeclined(
  userId: string,
  proposalId: string,
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      action: "AI_MUTATION_DECLINED",
      entityType: "Proposal",
      entityId: proposalId,
      metadata: { proposalId },
    },
  });
}

export type AuditEntry = {
  id: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  metadata: unknown;
};

export async function listAuditTrail(
  userId: string,
  take = 50,
): Promise<AuditEntry[]> {
  return prisma.auditEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
