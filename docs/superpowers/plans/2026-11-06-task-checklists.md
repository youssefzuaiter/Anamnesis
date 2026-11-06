# Task checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can hold a checklist of steps (add, tick, rename, reorder, remove), its progress shows on the task page and as a badge on the task list, and project and goal progress keep counting each task exactly once.

**Architecture:** One new table `TaskChecklistItem` (additive migration) that belongs to a task and a user; pure rules in `lib/checklist.ts`; a user-scoped repository and a service that refuses anything not the caller's own live task; server actions taking ids; a client `TaskChecklist` component on `/tasks/[id]`; an optional `checklist` badge prop on `TaskRow` fed by one grouped count on `/tasks`; the JSON export carries the items of live tasks.

**Tech Stack:** Next 16 server actions, Prisma 7 (new table), Zod, the existing node:test tiers and Playwright. No new dependency.

**Spec:** ROADMAP item 14 (`ROADMAP.md`): "Subtasks and checklists (M, migration). Progress rollups must keep counting each task once (see "Goals")." The Decisions below are the design. Read with them: CLAUDE.md "Goals" (progress is a raw task count), "Derived fields are set in one place", "Trash and soft-delete recovery", "Data export", "Testing UI with Playwright".

## Global Constraints

- No new dependency. One additive migration (a new table; the previous release does not know it and keeps working). SQL proven against the schema by replaying every migration into a throwaway database with `prisma migrate diff`, never `migrate dev`.
- Every query carries the session's `userId`; every id from the browser (task or item) is ownership-checked in the same query that uses it. A foreign, a missing, a trashed and a deleted-task id give **the same** `RESOURCE_NOT_FOUND`.
- At most 50 items per task; a title is 1 to 200 characters after cleaning (control characters and line breaks become spaces, runs of spaces collapse, ends trimmed, cut by characters without splitting a pair); shown as text only, never as HTML.
- A checklist item is **not a task**: no rollup, calendar, reminder, search, assistant or Today count ever sees one.
- Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never `git add -A` (`AGENTS.md` is rewritten by `next dev`). CPU budget: targeted specs at `nice -n 10`, Ollama off, one `pnpm build`, "CI runs the rest". Docker may be down: `open -a Docker`. Write backslash-heavy code with the Write tool or Python, not a shell heredoc.

## Decisions (made while shaping; the council was run by me inline, so weaker than four independent voices)

1. **Items are rows of their own, not child tasks.** Progress is a raw count of tasks (the "Goals" rule). A child task would either double-count the work (the parent and its steps) or force a leaf-or-parent rule that changes every number the person already sees; and every list, the calendar, Today, reminders, export and the assistant treat a task as a unit of work, where an item is a step inside one. **Cost accepted:** an item has no date, tags or priority and cannot be scheduled. **Not done, by design:** real child tasks with their own dates (a later, bigger change).
2. **A task's checklist progress is its own** ("2 of 5 done" on the task, a `2/5` badge on `/tasks`) and **never feeds project or goal progress**. Ticking every item does not complete the task: the page says so and the existing Mark complete stays the one way to finish it. A test pins that ticking items leaves every rollup unchanged.
3. **Order is explicit and reorderable by buttons** (Up and Down on each item), not by drag: it works on a phone, with a keyboard and with a screen reader. Positions are plain integers; a move renumbers, so gaps and duplicates left by deletes or races heal.
4. **Items follow their task.** Soft-deleting a task hides them (every read requires a live task), restoring brings them back, purging deletes them (cascade). **A recurring series does not copy a checklist**: occurrences are made at creation, before anyone has written one.
5. **At most 50 items per task, checked before an add.** Two adds at the same instant can pass it by one (nothing in the database forbids it); the cap is a limit on size, not a security boundary.
6. **The JSON export carries the items of live tasks** (`checklistItems`), so the file stays complete. Items are not in the vault, the search index or the assistant's context.

## Review Focus

- **A foreign, trashed or missing task or item id** in every operation: one refusal, and nothing of another account is read or written.
- **Ticking items must not move any project or goal progress**, and a task with items is still one task in every count.
- **A title that is markup, 100,000 characters, all control characters, or a lone surrogate**: stored cleaned, shown as text, never breaking the page.
- **Reordering when positions have gaps or duplicates**, at the first and last item, and with an id that is not in the list.
- **Trash, restore and purge**: items hidden with a trashed task, back on restore, gone on purge; the export holds only live tasks' items.

---

### Task 1: The checklist rules

**Files:**
- Create: `src/lib/checklist.ts`, `tests/unit/checklist.test.ts`

**Interfaces:**
- Produces:
  - `MAX_CHECKLIST_ITEMS = 50`, `MAX_ITEM_TITLE = 200`.
  - `cleanItemTitle(raw: string): string` — every control character (line breaks and tabs included) and U+2028/U+2029/U+0085 becomes a space, runs of whitespace collapse to one space, the ends are trimmed, the result is cut at 200 characters without splitting a surrogate pair; empty input gives `""`. Linear.
  - `type ChecklistProgress = { done: number; total: number; complete: boolean }`; `checklistProgress(items: readonly { done: boolean }[]): ChecklistProgress` — `complete` only when there is at least one item and all are done.
  - `type Positioned = { id: string; position: number }`; `nextPosition(items: readonly { position: number }[]): number` (one more than the largest, 0 for none); `moveItem(items: readonly Positioned[], id: string, direction: "up" | "down"): Positioned[] | null` — orders by (position, id), moves the item one place, and returns the rows whose position must be written so that positions become 0..n-1 in the new order (only those that differ from what is stored); null for an unknown id or an item already at that edge.

- [ ] **Step 1: Write the failing tests** (`tests/unit/checklist.test.ts`): `cleanItemTitle` for plain text, leading and trailing space, inner runs, tab, CR LF, U+2028, NUL and other controls, markup left as text (`<b>x</b>` unchanged), a 300-character title cut at 200, `😀` ×150 cut without a half pair, all-control input giving `""`, a lone surrogate, and 100,000 characters of spaces, of `a `, and of control characters each in under 50 ms; `checklistProgress` for none, some, all and a single item; `nextPosition` for none, a gap and unordered input; `moveItem` for up, down, the first item up and the last down (null), an unknown id (null), positions with gaps (`0, 5, 9`), duplicate positions (`1, 1, 1` ordered by id), and that applying the returned rows to the list gives exactly the intended order with positions 0..n-1.
- [ ] **Step 2: Run to see them fail** — `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/unit/checklist.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/lib/checklist.ts`** (pure, no Prisma, no React).
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit** — `git add src/lib/checklist.ts tests/unit/checklist.test.ts && git commit -m "feat(checklist): the rules of a task checklist"`.

### Task 2: Storage, the service and the export

**Files:**
- Create: `prisma/migrations/20261106140000_task_checklist_items/migration.sql`, `src/repositories/task-checklist-repository.ts`, `src/services/task-checklist-service.ts`, `tests/integration/task-checklist.test.ts`
- Modify: `prisma/schema.prisma` (the model and the two back-relations), `src/lib/export-shape.ts` (`TaskChecklistItem: "checklistItems"`), `src/services/export-service.ts` (one more table, in both forms of the file), `tests/unit/export-shape.test.ts` (the model count and the new key), `tests/integration/export.test.ts` (`populate` makes one item)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Schema: `model TaskChecklistItem { id (uuid), userId, taskId, title, done Boolean @default(false), position Int, createdAt, updatedAt; user and task relations both onDelete Cascade; @@index([taskId, position]); @@index([userId]) }`; `Task.checklistItems` and `User.taskChecklistItems` back-relations.
  - Repository (every function takes `userId` first and requires a live task): `listForTask(userId, taskId)` (ordered by position, createdAt, id), `countForTask(userId, taskId)`, `countsForTasks(userId, taskIds): Promise<Map<string, { done: number; total: number }>>` (one grouped query), `create(userId, taskId, title, position)`, `getItem(userId, itemId)`, `update(userId, itemId, data: { title?: string; done?: boolean }): Promise<boolean>`, `remove(userId, itemId): Promise<boolean>`, `writePositions(userId, taskId, rows: Positioned[]): Promise<void>` (one transaction, each write scoped by user and task), `listLiveForExport(userId, page: ExportPage)`.
  - Service: `getChecklist(userId, taskId): Promise<{ items: ChecklistItem[]; progress: ChecklistProgress }>`, `addItem(userId, taskId, title)`, `setItemDone(userId, itemId, done)`, `renameItem(userId, itemId, title)`, `removeItem(userId, itemId)`, `moveItem(userId, itemId, direction)`, `checklistCounts(userId, taskIds)`; a title that cleans to empty is `VALIDATION_ERROR` ("Write what needs doing."), the 51st item is `VALIDATION_ERROR` ("A checklist holds at most 50 items."), anything not the caller's own live task or item is `RESOURCE_NOT_FOUND` ("That checklist item no longer exists."), a non-string account id is refused before a query.

- [ ] **Step 1: Write the failing tests** (`tests/integration/task-checklist.test.ts`, two accounts): items come back in order and carry progress; add cleans the title (control characters, spaces, 300 characters) and refuses an empty one and the 51st; ticking and renaming persist and leave `Task.updatedAt` and the task's own columns alone; **a foreign task id, a foreign item id, a missing id, an item of a trashed task and an item of a deleted task give the same refusal for every operation and change nothing of the other account's** (assert the other account's rows are byte-identical after each attempt); move works at the edges, with gaps and with duplicate positions and writes only that task's rows; `countsForTasks` returns only the caller's counts and nothing for a foreign or trashed task; **ticking and adding items leaves a project's and a goal's `progress` unchanged and a task with items is counted once in `getGoalTaskTotals`** (the roadmap's rule); trashing a task hides its items, restoring brings them back with their order and ticks, purging removes the rows; deleting the account removes them; the JSON export of an account holds its live tasks' items and none of a trashed task's or another account's; a non-string account id is refused for every function.
- [ ] **Step 2: Run to see them fail** (`nice -n 10 pnpm exec tsx --conditions=react-server --test --test-timeout=300000 tests/integration/task-checklist.test.ts`; start Docker first if it is down). Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the schema and migration (prove the SQL by replaying every migration into a throwaway database: empty diff with it, exactly its statements without it; then `migrate deploy` on the development database and `prisma generate`), the repository, the service, and the export wiring.
- [ ] **Step 4: Run** the new file, `tests/integration/export.test.ts` and `tests/unit/export-shape.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add` the files above (named) `&& git commit -m "feat(checklist): checklist items on a task, a scoped service and the export"`.

### Task 3: The checklist on the task page, and the badge

**Files:**
- Create: `src/actions/task-checklist.ts`, `src/components/task-checklist.tsx`, `tests/e2e/task-checklist.spec.ts`
- Modify: `src/app/(dashboard)/tasks/[id]/page.tsx`, `src/app/(dashboard)/tasks/page.tsx`, `src/components/task-row.tsx`

**Interfaces:**
- Consumes: Task 2's service.
- Produces:
  - Actions (each: `requireUserId()` first, a Zod-parsed uuid for every id, a bounded string for a title, then the service, then `revalidatePath` of `/tasks` and `/tasks/[id]`): `addChecklistItemAction(taskId: string, title: string)`, `toggleChecklistItemAction(itemId: string, done: boolean)`, `renameChecklistItemAction(itemId: string, title: string)`, `removeChecklistItemAction(itemId: string)`, `moveChecklistItemAction(itemId: string, direction: "up" | "down")`, all `Promise<ApiResponse<null>>`.
  - `TaskChecklist({ taskId, items, taskDone })` (client): heading "Checklist", a `role="status"` line "2 of 5 done" that exists before it changes, each item a labelled tick button (`Mark "…" done` / `not done`), its title as text (struck through when done), Edit (an input in place, Enter saves, Escape cancels), Up, Down and Remove buttons (disabled at the edges, named with the item's title), an "Add an item" field with an Add button that keeps focus in the field after a successful add and clears it, the cap shown as a message at 50, a hint "Every item is done. Mark the task complete above." when all are done and the task is open, `role="alert"` for a refusal, a busy guard so a double click acts once, targets of at least 44px, the controls wrapping under the title on a phone with no sideways scroll.
  - `TaskRow` takes an optional `checklist?: { done: number; total: number }` and shows `2/5` (named "2 of 5 checklist items done") beside the other facts; `/tasks` passes it from one `checklistCounts` call for every task it lists.

- [ ] **Step 1: Write the failing e2e tests** (`tests/e2e/task-checklist.spec.ts`, no model): a new task's page offers "Checklist" and "0 of 0 done"; adding three items (one with Enter, one with the button) shows them in order and "0 of 3 done"; ticking one gives "1 of 3 done" and the `/tasks` row for that task shows `1/3`; Up and Down change the order and it survives a reload; Edit renames; Remove removes; ticking every item shows the hint and the task is still open until Mark complete is used; a title of `<img src=x onerror=alert(1)>` and one of 500 characters render as text and the page stays inside its width; a double click on Add adds one item; another task's page shows none of these; the phone at 375 and 360 in light and dark has no sideways overflow and every button is at least 44px high.
- [ ] **Step 2: Run to see them fail** (`E2E` default port 3100, the one spec, `nice -n 10`, Ollama off). Expected: FAIL.
- [ ] **Step 3: Implement** the actions, the component, the page and the row badge.
- [ ] **Step 4: Run** `task-checklist.spec.ts` and the existing specs that touch tasks (`workspace.spec.ts -g "task|goal|project"`, `daily.spec.ts`). Expected: PASS.
- [ ] **Step 5: Commit** — `git add` the files above (named) `&& git commit -m "feat(checklist): a checklist on the task page and its progress on the list"`.

## After the tasks (the loop, not plan tasks)

`security-review` (ownership of every id, the cap, titles as text, the migration); mutation checks on each rule and each `userId`; `simplify`; `tsc`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, the targeted specs, one `pnpm build`; a look at `/tasks/[id]` and `/tasks` at desktop and 375px in light and dark; `code-review` at xhigh; CLAUDE.md section "Task checklists", README, ROADMAP tick, `ops/README.md` only if how the app runs changed (it does not), `project_nexus.md` memory.
