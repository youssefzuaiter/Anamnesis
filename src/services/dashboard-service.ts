import "server-only";
import { prisma } from "@/lib/prisma";
import * as noteRepository from "@/repositories/note-repository";
import * as eventRepository from "@/repositories/event-repository";
import * as taskRepository from "@/repositories/task-repository";
import * as projectRepository from "@/repositories/project-repository";
import * as goalRepository from "@/repositories/goal-repository";
import * as courseRepository from "@/repositories/course-repository";
import * as flashcardRepository from "@/repositories/flashcard-repository";
import { bucketOf } from "@/services/task-service";
import { findTodayNote } from "@/services/daily-service";
import { pickRevisit, REVISIT_AFTER_DAYS, type Revisit } from "@/lib/note-revisit";
import type { NoteSummary } from "@/repositories/note-repository";
import type { ProjectSummary } from "@/repositories/project-repository";
import type { GoalSummary } from "@/repositories/goal-repository";
import type { UpcomingAssessment } from "@/repositories/course-repository";
import type {
  TaskModel as Task,
  EventModel as Event,
} from "@/generated/prisma/models";

export type TodayBlock = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  done: boolean;
};

export type Dashboard = {
  overdueTasks: Task[];
  todayTasks: Task[];
  todayEvents: Event[];
  todayBlocks: TodayBlock[];
  nextEvent: Event | null;
  recentNotes: NoteSummary[];
  activeProjects: ProjectSummary[];
  activeGoals: GoalSummary[];
  /** The soonest unscored assessment across all courses, for "Next exam". */
  nextAssessment: UpcomingAssessment | null;
  cardsDue: number;
  indexedChunks: number;
  /** Today's daily note if one exists; never created by loading the page. */
  todayNote: { id: string; updatedAt: Date } | null;
  /** One older note to come back to (ROADMAP item 32), or null. */
  revisit: Revisit | null;
};

/**
 * The note the dashboard offers back: read from the caller's own live notes changed before the thirty-day cutoff.
 * A read only; the card is hidden when there is nothing to offer.
 */
export async function getRevisit(userId: string, now = new Date()): Promise<Revisit | null> {
  const cutoff = new Date(now.getTime() - REVISIT_AFTER_DAYS * 86_400_000);
  const candidates = await noteRepository.listNotesChangedBefore(userId, cutoff, REVISIT_CANDIDATE_LIMIT);
  return pickRevisit(candidates, now);
}

const RECENT_NOTE_COUNT = 4;
const ACTIVE_PROJECT_COUNT = 3;
const ACTIVE_GOAL_COUNT = 3;
/** The oldest notes the revisit card can choose from. A personal workspace fits; past this the choice is the oldest. */
const REVISIT_CANDIDATE_LIMIT = 1000;

export async function getDashboard(
  userId: string,
  now = new Date(),
): Promise<Dashboard> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [
    openTasks,
    todayEvents,
    scheduled,
    upcoming,
    recentNotes,
    projects,
    goals,
    nextAssessment,
    cardsDue,
    indexedChunks,
    todayNote,
    revisit,
  ] = await Promise.all([
    taskRepository.listTasks(userId),
    eventRepository.listEventsInRange(userId, startOfToday, endOfToday),
    taskRepository.listScheduledInRange(userId, startOfToday, endOfToday),
    eventRepository.listUpcomingEvents(userId, now, 1),
    noteRepository.listNotes(userId, { take: RECENT_NOTE_COUNT }),
    projectRepository.listProjects(userId),
    goalRepository.listGoals(userId),
    courseRepository.nextUpcomingAssessment(userId, now),
    flashcardRepository.countDue(userId, now),
    prisma.workspaceEmbedding.count({ where: { userId } }),
    findTodayNote(userId, now),
    getRevisit(userId, now),
  ]);

  const overdueTasks = openTasks.filter(
    (task) => bucketOf(task, now) === "overdue",
  );
  const todayTasks = openTasks.filter((task) => bucketOf(task, now) === "today");

  // Only surface a "next up" event when nothing is left today, so the panel
  // never duplicates what the schedule already shows.
  const remainingToday = todayEvents.some((event) => event.endTime >= now);
  const nextEvent = remainingToday ? null : (upcoming[0] ?? null);

  const todayBlocks: TodayBlock[] = scheduled.flatMap((task) =>
    task.scheduledStart && task.scheduledEnd
      ? [{
          id: task.id,
          title: task.title,
          start: task.scheduledStart,
          end: task.scheduledEnd,
          done: task.status === "done",
        }]
      : [],
  );

  return {
    overdueTasks,
    todayTasks,
    todayEvents,
    todayBlocks,
    nextEvent,
    recentNotes,
    activeProjects: projects
      .filter((project) => project.progress < 100)
      .slice(0, ACTIVE_PROJECT_COUNT),
    activeGoals: goals
      .filter((goal) => goal.progress < 100)
      .slice(0, ACTIVE_GOAL_COUNT),
    nextAssessment,
    cardsDue,
    indexedChunks,
    todayNote,
    revisit,
  };
}
