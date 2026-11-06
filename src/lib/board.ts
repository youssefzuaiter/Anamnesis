// The rules of a project's Kanban board: the three columns, what a card carries, the one order cards are in, and the
// move the browser makes before the server has answered. Pure: no Prisma, no React, so the server that builds the
// board and the browser that moves a card in it share one order and a card never jumps when the page refreshes.

import { TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/domain";
import { bucketOf } from "@/lib/task-bucket";
import type { ChecklistCount } from "@/lib/checklist";
import { dueLabel } from "@/lib/due-label";

export const BOARD_COLUMNS: readonly { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

/** How many finished cards the Done column draws before "Show all". */
export const DONE_SHOWN = 10;

/** A card as the page draws it. The three trailing numbers are only there so the order can be recomputed. */
export type BoardCard = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueLabel: string | null;
  /** A fact about the date: the page shows "Overdue" only while the card is open. */
  pastDue: boolean;
  estimatedMinutes: number;
  recurring: boolean;
  checklist: ChecklistCount | null;
  dueAt: number | null;
  createdAt: number;
  completedAt: number | null;
};

/** The columns of a task row the board reads; status and priority are strings in the database. */
export type BoardTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  estimatedMinutes: number;
  recurrenceId: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

const COLUMN_RANK: Record<TaskStatus, number> = { todo: 0, in_progress: 1, done: 2 };
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

const isStatus = (value: string): value is TaskStatus => (TASK_STATUSES as readonly string[]).includes(value);
// Own keys only: `value in object` is also true for "constructor", "toString" and the rest of Object.prototype.
const isPriority = (value: string): value is TaskPriority => Object.prototype.hasOwnProperty.call(PRIORITY_RANK, value);

const byId = (a: BoardCard, b: BoardCard) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The one order. Columns in board order. An open column: due date (none last), then priority (high first), then
 * oldest first, then id. Done: most recently finished first (never finished last), then id.
 */
function compare(a: BoardCard, b: BoardCard): number {
  if (a.status !== b.status) return COLUMN_RANK[a.status] - COLUMN_RANK[b.status];
  if (a.status === "done") {
    if (a.completedAt !== b.completedAt) {
      if (a.completedAt === null) return 1;
      if (b.completedAt === null) return -1;
      return b.completedAt - a.completedAt;
    }
    return byId(a, b);
  }
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt - b.dueAt;
  }
  if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return byId(a, b);
}

export function sortCards(cards: readonly BoardCard[]): BoardCard[] {
  return [...cards].sort(compare);
}

/**
 * The cards of a project, in order. `counts` holds the checklist steps of the tasks that have any. A status or a
 * priority the app never writes is read as the safe one (to do, medium) rather than dropping the task.
 */
export function toBoardCards(tasks: readonly BoardTask[], now: Date, counts: ReadonlyMap<string, ChecklistCount>): BoardCard[] {
  return sortCards(
    tasks.map((task) => {
      const steps = counts.get(task.id);
      return {
        id: task.id,
        title: task.title,
        status: isStatus(task.status) ? task.status : "todo",
        priority: isPriority(task.priority) ? task.priority : "medium",
        dueLabel: task.dueDate ? dueLabel(task.dueDate) : null,
        pastDue: bucketOf(task, now) === "overdue",
        estimatedMinutes: task.estimatedMinutes,
        recurring: task.recurrenceId !== null,
        checklist: steps && steps.total > 0 ? { done: steps.done, total: steps.total } : null,
        dueAt: task.dueDate ? task.dueDate.getTime() : null,
        createdAt: task.createdAt.getTime(),
        completedAt: task.completedAt ? task.completedAt.getTime() : null,
      };
    }),
  );
}

/**
 * What the board looks like once a card is in another column, before the server has said so: the same change
 * `setTaskStatus` makes (finished time set on Done, cleared otherwise) and the same order. `at` is the moment of
 * the move, passed in so this stays a pure function. A missing card, or one already there, changes nothing.
 */
export function moveCard(cards: readonly BoardCard[], id: string, to: TaskStatus, at: number): BoardCard[] {
  const card = cards.find((c) => c.id === id);
  if (!card || card.status === to) return [...cards];
  return sortCards(cards.map((c) => (c.id === id ? { ...c, status: to, completedAt: to === "done" ? at : null } : c)));
}

/** The three columns, always, each holding its cards in the order they were given. */
export function columnsOf(cards: readonly BoardCard[]): { status: TaskStatus; label: string; cards: BoardCard[] }[] {
  return BOARD_COLUMNS.map((column) => ({ ...column, cards: cards.filter((c) => c.status === column.status) }));
}

/** The two columns a card in `status` can be moved to, in board order. */
export function otherColumns(status: TaskStatus): { status: TaskStatus; label: string }[] {
  return BOARD_COLUMNS.filter((column) => column.status !== status).map((column) => ({ ...column }));
}
