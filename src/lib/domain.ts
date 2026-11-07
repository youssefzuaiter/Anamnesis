// Shared domain vocabulary. Deliberately free of `server-only` and of any
// database import: client components need these values for their form controls,
// and importing them from a repository would pull Prisma into the browser bundle.

// Shared by Project and Goal — a goal is University/Career/Personal in exactly
// the same sense a project is, so this stays one constant rather than two
// near-identical enums.
export const PROJECT_CATEGORIES = ["University", "Career", "Personal"] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type ProjectOption = { id: string; title: string };
export type GoalOption = { id: string; title: string };

// The entities that support soft delete, and so can appear in the trash.
// Lives here rather than in actions/trash.ts because a "use server" module may
// only export async functions — exporting this from there made every restore
// and purge fail at runtime with "can only export async functions".
export const TRASH_KINDS = ["note", "task", "project", "goal"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

// Shared between the unscheduled-tasks drag source and the calendar's drop
// targets so a typo in one place can't silently break the other.
export const TASK_DRAG_MIME = "application/x-nexus-task-id";

// The tray also puts the task's estimate (minutes) into the *type* of the drag, after this prefix. A drop target can
// read the types of a drag while the pointer is still over it, but not the data, and the hourly grid needs the
// length to draw where the block would land. Only the person's own browser ever reads it, and only to place a preview.
export const TASK_MINUTES_MIME_PREFIX = "application/x-nexus-task-minutes-";

// A card dragged between the columns of a project board. A different type from the one above on purpose: the
// calendar's drop targets look for TASK_DRAG_MIME, so a board card must not light them up.
export const BOARD_DRAG_MIME = "application/x-anamnesis-board-task-id";

/**
 * Announced on `window` after something moves tasks in or out of "due today"
 * (Shut down day), so the Due now panel, which only polls on mount and every
 * few minutes, refetches instead of showing tasks that have since moved.
 */
export const TASKS_CHANGED_EVENT = "anamnesis-tasks-changed";

/** How long a flashcard's question and answer may be. The editor, the action and the service agree on these. */
export const MAX_CARD_QUESTION = 1000;
export const MAX_CARD_ANSWER = 2000;
