# Project Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project page gets a **Board** view: three columns (To do, In progress, Done) by the existing task status, cards that move by drag on desktop and by buttons everywhere, and one column at a time (tabs) below 1024px.

**Architecture:** Pure rules in `lib/board.ts` (card shape, one sort, the optimistic move); one client-callable action `moveTaskAction` that reuses `taskService.setTaskStatus` (ownership, derived `completedAt`, project and goal progress); one client component `task-board.tsx` using `useOptimistic`; the project page gets a `?view=list|board` switch (list stays the default). No migration, no new dependency.

**Tech Stack:** Next.js 16 / React 19 (`useOptimistic`, native HTML5 drag and drop), Prisma 7 (no schema change), Tailwind with the Quiet Studio tokens.

**Spec:** `ROADMAP.md` item 15 ("Kanban view for projects (M, demo)") and the approved design canvas, https://claude.ai/artifact/LmHaAZfBPWbXFnTa8z8fcP (desktop light and dark, a card being dragged, empty columns, phone with tabs, and a stacked-phone alternative that was **not** chosen). The user's answer: "yes, build it with tabs on phone".

## Decisions (made while shaping; no council was needed: the real forks were settled by the design review)

1. **Columns are the three existing statuses** (`todo`, `in_progress`, `done`). `in_progress` has existed in the schema and `TASK_STATUSES` since the start but nothing in the app set it; every reader already treats it as open (the daily carry-over has a unit test for it, progress is a raw count of `done / total`). Moving a card is exactly `setTaskStatus`, so project and goal progress keep counting each task once ("Goals").
2. **No stored order inside a column (no migration).** The order is derived, one rule, used by the server and by the optimistic move so a card never jumps when the refreshed list arrives: open columns by due date (none last), then priority (high, medium, low), then created, then id; Done by most recently completed. **Cost accepted:** cards cannot be hand-ordered; a position column would be a migration.
3. **Moving:** drag between columns on desktop (native HTML5, the calendar's pattern, no dependency, its own MIME type so the calendar's drop targets ignore a board card), and **buttons on every card for the other two columns** (drag does not exist on touch or by keyboard). The checkbox keeps completing and reopening, through the same move.
4. **Optimistic, with the truth from the server.** The card moves at once (`useOptimistic`); if the action refuses or the request fails it goes back and a `role="alert"` says why; a refusal because the task is gone refreshes the list. A `role="status"` region announces each move. **One move at a time:** while one is in flight every move control is `aria-disabled` and a drop is ignored, because the optimistic move reflows the column and the next card slides under the cursor; a double click must move one card once and never a neighbour.
5. **Where:** a List | Board switch on `/projects/[id]` (`?view=board`; anything else is the list), so every existing view and test is unchanged by default. The board widens the page (`max-w-6xl`); the list keeps `max-w-3xl`. A project with no tasks shows the existing "No tasks yet" message in both views.
6. **Phone and tablet (below `lg`, 1024px): tabs, one column at a time** (the user's choice). The plan first said `md`; the sidebar is there from `lg`, so a 768px screen has about 520px of content, too narrow for three columns. The three columns are always in the DOM and CSS shows one; the switch is a `role="group"` of `aria-pressed` buttons ("To do 4"), not `role="tab"`, because the same sections are all visible side by side on desktop, where a tab panel role would be wrong. Tab buttons and card buttons are at least 44px tall.
7. **Done shows the 10 most recently completed** with a "Show all N" button (`aria-expanded`); the count in the header is the true count. A bound on what a long-running project draws.
8. **Cards carry** the title (a link to the task), due date ("Overdue · 3 Nov" in the warn colour for an open past-due task), priority word, estimate, the `2/5` checklist badge from item 14 (read through the existing `checklistCounts`), and the repeat mark. Tags and descriptions stay on the list and the task page. Not drawn, so not built: the app shell.
9. **Drag onto the column a card is already in does nothing.** The drop highlight is `bg-accent-soft` with a dashed accent outline, as the calendar's cell is.

## Global Constraints

- Free self-hosted stack; **no new dependency, no migration**.
- Every query scoped by the session's `userId`; every client-supplied id ownership-checked in the query that uses it (`setTaskStatus` already does; foreign, missing and trashed give the same `RESOURCE_NOT_FOUND`).
- Quiet Studio tokens only (`bg-surface`, `border-border-subtle`, `text-text-muted`, `bg-accent-soft`, `text-warn`, `min-h-11`); light and dark designed together.
- Interactive controls: real `<button>` and `<a>`, labelled with the task they act on; 44px targets on a phone; **buttons are `aria-disabled`, never `disabled`, while busy** (a focused button that becomes disabled loses the keyboard's place; found on item 14).
- Client non-form click handlers need the page refreshed: `revalidateTaskViews` must reach `/projects/[id]` (today it revalidates only `/projects`).
- React 19 lint: no `setState` in an effect body.
- Browser tests select by label and by `main`; one shared account per run; targeted specs only ("CI runs the rest").
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A move for a task that is another account's, trashed, or gone** is refused identically and changes nothing (integration, Task 2); the browser shows the reason and the card leaves when the task was removed elsewhere (Task 3).
2. **The action fails or the network drops** after the card moved: it must return to its column with a message, not stay in a column the server never agreed to (Task 3, route aborted).
3. **A refreshed list must not flash the card back** into its old column between the optimistic move and the new props (Task 3, a `MutationObserver` on the old column).
4. **Keyboard and touch can do everything a drag does**, and focus stays on the moved card (Task 3).
5. **A project with thousands of tasks**: what the board draws and costs (measured in the security review; Done is bounded by Decision 7).
6. A done task moved back clears `completedAt`; moving to `in_progress` changes no progress figure (Task 2).
7. **A double click on a Move button** must move one card once, and the card that slides into its place must not be touched (Task 3).

---

### Task 1: The board's rules

**Files:**
- Create: `src/lib/board.ts`, `tests/unit/board.test.ts`
- Modify: `src/lib/domain.ts` (add `BOARD_DRAG_MIME`)

**Interfaces:**
- Consumes: `TaskStatus`, `TaskPriority`, `TASK_STATUSES` from `@/lib/domain`; `bucketOf` from `@/lib/task-bucket`; `ChecklistCount` from `@/lib/checklist`.
- Produces (exact):
  - `export const BOARD_DRAG_MIME = "application/x-anamnesis-board-task-id"` (in `domain.ts`).
  - `export const BOARD_COLUMNS: readonly { status: TaskStatus; label: string }[]`: To do, In progress, Done, in that order.
  - `export const DONE_SHOWN = 10`.
  - `export type BoardCard = { id: string; title: string; status: TaskStatus; priority: TaskPriority; dueLabel: string | null; pastDue: boolean; estimatedMinutes: number; recurring: boolean; checklist: ChecklistCount | null; dueAt: number | null; createdAt: number; completedAt: number | null }`.
  - `export type BoardTask = { id: string; title: string; status: string; priority: string; dueDate: Date | null; estimatedMinutes: number; recurrenceId: string | null; createdAt: Date; completedAt: Date | null }`.
  - `export function toBoardCards(tasks: readonly BoardTask[], now: Date, counts: ReadonlyMap<string, ChecklistCount>): BoardCard[]` (sorted by `sortCards`; an unknown status is treated as `todo`, an unknown priority as `medium`; `checklist` is null when there are no steps; `pastDue` is `bucketOf(task, now) === "overdue"`).
  - `export function sortCards(cards: readonly BoardCard[]): BoardCard[]` (a new array; the rule in Decision 2).
  - `export function moveCard(cards: readonly BoardCard[], id: string, to: TaskStatus, at: number): BoardCard[]` (status `to`; `completedAt` is `at` when `to` is `done`, else null; sorted; the same array contents when the card is missing or already there).
  - `export function columnsOf(cards: readonly BoardCard[]): { status: TaskStatus; label: string; cards: BoardCard[] }[]` (always three, in order, cards keep their order).
  - `export function otherColumns(status: TaskStatus): { status: TaskStatus; label: string }[]` (the two other columns, in column order).

- [ ] **Step 1: Write the failing tests** (`tests/unit/board.test.ts`): the column list and labels; `sortCards` open columns by due date with no date last, then high before medium before low, then older created first, then id; Done by `completedAt` descending (none last); `toBoardCards` turns a due date into `"14 Nov"` (en-GB, day and short month), marks a task due yesterday `pastDue` and one due today not, reads `checklist` from the map and gives null for a task with none, `recurring` from `recurrenceId`, and treats `"weird"` status as `todo`; `moveCard` to `done` stamps `completedAt`, from `done` clears it, to the same column returns equal cards, an unknown id changes nothing, and **the result equals what `toBoardCards` would give for the same tasks after the same change** (one rule for server and client); `columnsOf` always returns three columns; `otherColumns("in_progress")` is To do then Done; a 5,000-card sort and move finish in a few milliseconds.
- [ ] **Step 2: Run to see it fail:** `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/unit/board.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/lib/board.ts` and `BOARD_DRAG_MIME`.** One comparator shared by `sortCards` and `moveCard`; no Prisma, no React.
- [ ] **Step 4: Run to see it pass.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(board): the rules of a project board`.

### Task 2: Moving a task

**Files:**
- Modify: `src/actions/tasks.ts` (add `moveTaskAction`; `revalidateTaskViews` also revalidates `"/projects/[id]"` as a `"page"`)
- Create: `tests/integration/board.test.ts`

**Interfaces:**
- Consumes: `taskService.setTaskStatus(userId, taskId, status)` (unchanged).
- Produces: `export async function moveTaskAction(taskId: string, status: TaskStatus): Promise<ApiResponse<null>>`: input parsed with Zod first (`z.uuid()`, `z.enum(TASK_STATUSES)`, a bad value is `VALIDATION_ERROR`), then `requireUserId()`, then the service; failures through `toApiResponse`; on success `revalidateTaskViews(taskId)`.

- [ ] **Step 1: Write the failing integration tests** (`tests/integration/board.test.ts`, each test its own accounts): `setTaskStatus` through `todo` → `in_progress` → `done` → `in_progress` → `todo`: `completedAt` is null, null, set, null, null; the project's `progress` stays 0 while `in_progress` and is 100 at `done` for a one-task project, 0 again after; a goal's `getGoalTaskTotals` counts the task once throughout; a foreign task id, a missing id and a trashed task's id each fail with the same `RESOURCE_NOT_FOUND` and message and leave the other account's task byte for byte unchanged; moving to the status it already has changes nothing else (`updatedAt` aside) and is not an error.
- [ ] **Step 2: Run them.** **These tests pin existing behaviour the board newly depends on** (`in_progress` had no UI until now), so they pass at once; they are kept because the board's correctness rests on them, and mutation checks on the service show they can fail. The new code, `moveTaskAction`, needs a session and cannot run in the node tests: it is covered by Task 3's browser tests, which fail first. `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/integration/board.test.ts`. Expected: pass.
- [ ] **Step 3: Implement `moveTaskAction`** and add `revalidatePath("/projects/[id]", "page")` to `revalidateTaskViews`.
- [ ] **Step 4: `tsc` and the integration file pass.**
- [ ] **Step 5: Commit** `feat(board): move a task between columns`.

### Task 3: The board on the project page

**Files:**
- Create: `src/components/task-board.tsx`, `tests/e2e/board.spec.ts`
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce; `checklistCounts(userId, taskIds)` from `@/services/task-checklist-service`.
- Produces: `export function TaskBoard({ cards }: { cards: BoardCard[] })` (client). The page reads `searchParams.view` (`"board"` only; anything else is the list), builds the cards with `toBoardCards(tasks, now, counts)` from the tasks it already loaded, renders the switch (`<nav aria-label="Task view">` with two links, `aria-current` on the active one) beside the "Tasks · N" heading, and renders `TaskBoard` instead of the list in board view.

- [ ] **Step 1: Write the failing browser tests** (`tests/e2e/board.spec.ts`, no model; each test makes its own project and tasks through the forms): the project page opens as the list and Board is opt-in (no board region in the list); Board shows three named columns with their counts and each task in the column its status says; **Move buttons** put a card in In progress and in Done, counts and the page's progress bar follow (`In progress` leaves the progress at 0, Done makes it 100), it survives a reload; **drag** a card to another column with `dragTo`; dropping on its own column does nothing; the checkbox completes and reopens; **a failed move** (route the POST to abort) returns the card to its column with an alert; **a task removed behind the page's back** (database delete) gives "no longer exists", the card leaves and nothing else moves; **no flash back** (a `MutationObserver` on the old column sees the card's title appear there at most never after the move); **keyboard**: focus a Move button, press Enter, focus is on the moved card's title link; Done shows 10 and "Show all 12" with `aria-expanded`; **a double click on a Move button moves one card once** and the card that slides into its place stays where it was; a trashed task and another project's task are not on the board; the page's task titles appear once in board view; **phone 375px light and dark**: no horizontal overflow, the "Show column" group, only the chosen column visible, switching shows another, every button at least 44px, Move buttons work; at desktop width the column group is not visible.
- [ ] **Step 2: Run to see it fail:** `nice -n 10 pnpm exec playwright test tests/e2e/board.spec.ts --reporter=list`. Expected: FAIL on the missing Board switch.
- [ ] **Step 3: Implement `TaskBoard` and wire the page** as Decisions 3 to 9 say: `useOptimistic` with `moveCard`; the move runs inside a transition and `isPending` makes every move control `aria-disabled` (clicks and drops are ignored in the handlers); drag sets and reads `BOARD_DRAG_MIME`; focus returns to the moved card's title link by `data-focus-key`.
- [ ] **Step 4: Run the spec and the neighbouring specs** (`workspace.spec.ts -g "goal|project|task"`, `daily.spec.ts`, `task-checklist.spec.ts`): all pass.
- [ ] **Step 5: Commit** `feat(board): a Kanban view for projects`.
