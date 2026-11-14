# Weekly review: goals, courses, no model Implementation Plan

**Goal:** The weekly review at `/review` shows how goals and courses moved this week, and what assessments fall due next week, as plain queries. The model-written summary is removed, because the roadmap says "no model" and nothing here is written.

**Architecture:** The page already existed (tasks finished, slipped, notes touched, cards, what is coming up). This adds three sections from the existing repositories' tables: goals (tasks finished toward each goal this week, directly or through a live project, counted once per task; the goal's current progress), courses (tasks finished this week per live course), and unscored assessments due in the next seven days. A pure helper counts tasks per goal and per course. Removed: `summariseWeek`, the action that wrapped it, and the `WeekSummary` component.

**Spec:** ROADMAP item 31: "Weekly review (S, demo). A read-only page: tasks finished, notes written, how goals and courses moved, what is overdue and what comes next week. Plain queries over the existing repositories; no model, and nothing is written."

**Limit, stated plainly:** Assessments store no time of scoring, so "assessments scored this week" cannot be shown without a migration. The page shows what is due next week, not what was scored.

## Global Constraints
- Every query carries the session's `userId`; deleted goals, courses and projects never count.
- A task reached through both a direct goal link and a project counts once for that goal.
- No model call, no write, no migration.

## Review Focus
1. Another account's goal or course id never appears, even with a shared task.
2. A task finished through a soft-deleted project does not count for its goal.
3. The window: "this week" uses the same whole-day window as before.
4. Scored assessments never appear as due.

### Task 1: `src/lib/weekly-review.ts` (pure) and unit tests.
### Task 2: service queries and integration tests (real database).
### Task 3: page sections, delete the model path, browser test at desktop and phone width, light and dark.
### Task 4: CLAUDE.md, README, ROADMAP.
