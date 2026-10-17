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
