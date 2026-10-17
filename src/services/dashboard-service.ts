import "server-only";
import { prisma } from "@/lib/prisma";
import * as noteRepository from "@/repositories/note-repository";
import * as eventRepository from "@/repositories/event-repository";
import * as taskRepository from "@/repositories/task-repository";
import * as projectRepository from "@/repositories/project-repository";
import * as goalRepository from "@/repositories/goal-repository";
import { bucketOf } from "@/services/task-service";
import type { NoteSummary } from "@/repositories/note-repository";
import type { ProjectSummary } from "@/repositories/project-repository";
import type { GoalSummary } from "@/repositories/goal-repository";
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
  indexedChunks: number;
};

const RECENT_NOTE_COUNT = 4;
const ACTIVE_PROJECT_COUNT = 3;
const ACTIVE_GOAL_COUNT = 3;

export async function getDashboard(
  userId: string,
  now = new Date(),
): Promise<Dashboard> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [openTasks, todayEvents, scheduled, upcoming, recentNotes, projects, goals, indexedChunks] =
    await Promise.all([
      taskRepository.listTasks(userId),
      eventRepository.listEventsInRange(userId, startOfToday, endOfToday),
      taskRepository.listScheduledInRange(userId, startOfToday, endOfToday),
      eventRepository.listUpcomingEvents(userId, now, 1),
      noteRepository.listNotes(userId, { take: RECENT_NOTE_COUNT }),
      projectRepository.listProjects(userId),
      goalRepository.listGoals(userId),
      prisma.workspaceEmbedding.count({ where: { userId } }),
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
    indexedChunks,
  };
}
