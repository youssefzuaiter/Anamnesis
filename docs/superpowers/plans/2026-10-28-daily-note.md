# Daily note and Shut down day: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today gets an "Open today's note" card (one note per day, filled with that day's schedule and open tasks) and a "Shut down day" panel that moves unfinished tasks to tomorrow in one confirmed step.

**Architecture:** Pure rules live in `src/lib/daily.ts` (the note's title and Markdown, which tasks are unfinished, the new due date). `src/services/daily-service.ts` does the database work: it finds or creates today's note and proposes and applies the carry-over, re-deriving the list from scratch before writing, the way Plan my day does. Two server actions expose it; two client components (`TodayNote`, `ShutDownDay`) sit on the Today page. No schema change.

**Tech Stack:** Next.js 16, React 19, Prisma 7 / Postgres, Tailwind 4 tokens, `node:test`, Playwright. No new dependency.

**Spec:** the design the user approved on 2026-10-28 ("yes build it"): https://claude.ai/artifact/U5rZe4wWhdNHR13J49CQV8, the council decision recorded below, and `ROADMAP.md` item 4. A medium change with no separate spec file; this plan carries the design.

## Global Constraints

- Free and local only; no new dependency; **no schema change or migration** (the council on 2026-10-28 chose a convention over a column: a daily note is an ordinary note, so search, backlinks, export and `[[2026-10-28]]` links need no special case, and a `dailyDate` column can be added later without breaking anything).
- A daily note is the account's non-deleted note whose `title` is the local ISO date (`2026-10-28`) and whose `tags` include `daily`. Lookups are scoped by `userId`; if several match, the earliest by `createdAt` wins. It is created only when the person clicks, never when the page loads. Its content is a snapshot made at creation.
- "Unfinished" means a task whose status is not `done` and that has a due date. **Due today** uses the existing whole-day bucket rule (a task due 09:00 is still today at 18:00). **Overdue** is due before this morning. Undated tasks and done tasks are never listed.
- Moving a task sets its due date to tomorrow at the same time of day it had (an overdue task lands on tomorrow, not the day after its old date), clears a planned block that starts today, and changes nothing else; done tasks and events are untouched. A planned block on another day stays.
- Propose, confirm, re-derive: `applyShutdown` rebuilds the list on the server and moves only the requested ids that are in it. A client-sent id that is not in the caller's own list (another account's task, a done task, one already moved) is ignored; if none are left it fails with `VALIDATION_ERROR` and moves nothing.
- "Today" and "tomorrow" are the server's local calendar days, as everywhere else. Day labels use `dateLabel` from `lib/note-templates` ("Thu 29 Oct"); times are 24-hour `HH:MM` from `Intl.DateTimeFormat("en-GB")`.
- The panel mirrors Plan my day (`rounded-xl bg-surface-subtle p-3.5`); no browser pop-up; rows are native checkboxes inside `<label>`s, at least 44px tall; the Move button is the only accent button in the panel; text no smaller than 12px; priority is always shown as a word.
- The cards are inside the dashboard's non-empty branch only (an empty workspace keeps its onboarding message).
- `bucketOf` keeps its exact behaviour; it moves into `lib/` so pure code can use it, and `task-service` re-exports it.
- Project rules in `CLAUDE.md` apply: layering (UI, action, Zod, service, repository), every query scoped by the session's `userId`, `pnpm build` before calling it done, the e2e suite selects by label and by `main`. Commit messages end with the `Co-Authored-By` line the session's attribution reminder gives.

## Review Focus

Each line has its test in the task named.

1. Opening today's note twice never creates two; another account's note with the same title never counts; a soft-deleted daily note is not found. (Task 3)
2. Another account's task is never moved, listed or counted, even if its id is sent. (Task 3)
3. Shutting down twice: the second apply finds nothing and moves nothing. (Task 3)
4. A task due at 09:00 and one due at 23:59 today are both "today"; one due yesterday is overdue; an overdue task moved lands on tomorrow. (Tasks 1 and 2)
5. A done task and an undated task are never listed. (Task 2)
6. Only a planned block that starts today is cleared; one planned tomorrow stays. (Tasks 2 and 3)
7. Month rollover (31 Oct to 1 Nov) and the time of day survive `tomorrowDue`. (Task 2)
8. An event that starts before today or ends after it is shown with "from", "until" or "All day", not with times outside the day. (Task 1)
9. On a phone the panel fits, every row and button is at least 44px, and the page does not widen. (Task 4)

---

### Task 1: The note's title and Markdown, and the bucket rule moved to `lib/`

**Files:**
- Create: `src/lib/task-bucket.ts`, `src/lib/daily.ts`
- Modify: `src/services/task-service.ts` (use and re-export `bucketOf` and `TaskBucket`)
- Test: `tests/unit/task-bucket.test.ts`, `tests/unit/daily.test.ts`

**Interfaces:**
- Consumes: `dateLabel` is not needed here; nothing from earlier tasks.
- Produces:
  - `src/lib/task-bucket.ts`: `type TaskBucket = "overdue" | "today" | "upcoming" | "someday"` and `bucketOf(task: { dueDate: Date | null }, now?: Date): TaskBucket` (the existing function, body unchanged, parameter type widened).
  - `src/lib/daily.ts`: `const DAILY_TAG = "daily"`, `dailyTitle(day: Date): string`, `type DailyEvent = { title: string; start: Date; end: Date; location: string | null }`, `type DailyBlock = { title: string; start: Date; end: Date }`, `type DailyTask = { title: string; priority: string }`, `buildDailyNote(input: { day: Date; events: readonly DailyEvent[]; blocks: readonly DailyBlock[]; tasks: readonly DailyTask[] }): string`.

- [ ] **Step 1: Write the failing tests.**

`tests/unit/task-bucket.test.ts` (imports `bucketOf` from `@/lib/task-bucket`; `const NOW = new Date(2026, 9, 28, 18, 0)`): no due date is `someday`; due `new Date(2026, 9, 28, 9, 0)` is `today` at 18:00; `23:59:59.999` today is `today`; 00:00 tomorrow is `upcoming`; yesterday 23:59 is `overdue`; today 00:00 is `today`.

`tests/unit/daily.test.ts` (`const DAY = new Date(2026, 9, 28, 14, 5)`, a helper `at(h, m, dayOffset = 0)` building local dates):

```ts
test("the title is the local ISO date", () => {
  assert.equal(dailyTitle(new Date(2026, 9, 28, 23, 59)), "2026-10-28");
  assert.equal(dailyTitle(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
  assert.equal(DAILY_TAG, "daily");
});

test("a day with an event, a planned block and three tasks matches the approved design", () => {
  assert.equal(
    buildDailyNote({
      day: DAY,
      events: [{ title: "ML midterm", start: at(9, 0), end: at(11, 0), location: "Hall C" }],
      blocks: [{ title: "Draft related-work section", start: at(14, 0), end: at(15, 0) }],
      tasks: [
        { title: "Draft related-work section", priority: "high" },
        { title: "Review week 6 slides", priority: "medium" },
        { title: "Email supervisor about thesis topic", priority: "low" },
      ],
    }),
    [
      "## Schedule",
      "- 09:00–11:00 ML midterm, Hall C",
      "- 14:00–15:00 Draft related-work section (planned)",
      "",
      "## Open tasks",
      "- [ ] Draft related-work section (high, due today)",
      "- [ ] Review week 6 slides (medium, due today)",
      "- [ ] Email supervisor about thesis topic (low, due today)",
      "",
      "## Notes",
      "",
    ].join("\n"),
  );
});

test("an empty day says so instead of leaving empty lists", () => {
  assert.equal(
    buildDailyNote({ day: DAY, events: [], blocks: [], tasks: [] }),
    "## Schedule\nNothing scheduled.\n\n## Open tasks\nNo open tasks due today.\n\n## Notes\n",
  );
});

test("the schedule is in time order, an event before a block that starts with it", () => {
  const out = buildDailyNote({
    day: DAY,
    events: [{ title: "Lab", start: at(16, 0), end: at(17, 0), location: null }, { title: "Stand-up", start: at(9, 0), end: at(9, 15), location: null }],
    blocks: [{ title: "Read paper", start: at(9, 0), end: at(10, 0) }],
    tasks: [],
  });
  assert.deepEqual(out.split("\n").slice(1, 4), [
    "- 09:00–09:15 Stand-up", "- 09:00–10:00 Read paper (planned)", "- 16:00–17:00 Lab",
  ]);
});

test("an event that crosses the day's edges is described honestly", () => {
  const out = buildDailyNote({
    day: DAY,
    events: [
      { title: "Conference", start: at(9, 0, -1), end: at(17, 0, 1), location: null },
      { title: "Night shift", start: at(22, 0, -1), end: at(2, 0), location: null },
      { title: "Overnight lab", start: at(22, 0), end: at(3, 0, 1), location: null },
    ],
    blocks: [], tasks: [],
  });
  assert.ok(out.includes("- All day Conference"));
  assert.ok(out.includes("- until 02:00 Night shift"));
  assert.ok(out.includes("- from 22:00 Overnight lab"));
});
```

- [ ] **Step 2: Run to confirm failure.** Run: `pnpm exec tsx --conditions=react-server --test tests/unit/task-bucket.test.ts tests/unit/daily.test.ts` — Expected: FAIL, cannot find `@/lib/task-bucket` and `@/lib/daily`.
- [ ] **Step 3: Implement.** `lib/task-bucket.ts`: move `bucketOf` and `TaskBucket` out of `task-service.ts` unchanged (widen the parameter to `{ dueDate: Date | null }`); in `task-service.ts` import them, `export { bucketOf }` and `export type { TaskBucket }`, so `dashboard-service` and the other callers need no change. `lib/daily.ts`: pure, no React, no Prisma; one module-level `Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })`; an item that starts and ends inside `day`'s local calendar day shows `HH:MM–HH:MM`; one that starts before the day and ends after it shows `All day`; starts before and ends inside shows `until HH:MM`; starts inside and ends after shows `from HH:MM`; sort by start (stable, events before blocks); a block's line ends with ` (planned)`; an event's line ends with `, <location>` when it has one; task lines are `- [ ] <title> (<priority>, due today)`; the note ends with `## Notes` and a newline.
- [ ] **Step 4: Run to confirm pass.** The Step 2 command, then `pnpm test` and `pnpm exec tsc --noEmit` — Expected: all pass; the existing suites are unchanged.
- [ ] **Step 5: Commit** the plan and the five files ("Add the daily note's title and Markdown, and move the bucket rule to lib").

---

### Task 2: Which tasks are unfinished, and where they go

**Files:**
- Modify: `src/lib/daily.ts`
- Test: `tests/unit/daily.test.ts`

**Interfaces:**
- Consumes: `bucketOf` from `lib/task-bucket`; `dateLabel` from `lib/note-templates`.
- Produces (exported from `src/lib/daily.ts`):
  - `type CarryTask = { id: string; title: string; priority: string; status: string; dueDate: Date | null; scheduledStart: Date | null; scheduledEnd: Date | null }`
  - `type CarryOverItem = { id: string; title: string; priority: string; dueDate: Date; plannedStart: Date | null; plannedEnd: Date | null }` (`plannedStart` and `plannedEnd` are set only when the task's block starts today)
  - `type CarryOverPlan = { dueToday: CarryOverItem[]; overdue: CarryOverItem[] }`
  - `planCarryOver(tasks: readonly CarryTask[], now: Date): CarryOverPlan` (input order kept; done and undated tasks, and tasks due later, are left out)
  - `tomorrowDue(due: Date, now: Date): Date` (tomorrow's local date at `due`'s time of day)
  - `carryDetail(item: CarryOverItem, group: "dueToday" | "overdue"): string`: `""`, `"planned 14:00–15:00, will be cleared"`, `"due Mon 26 Oct"` or `"due Mon 26 Oct, planned 14:00–15:00, will be cleared"` (an overdue task's detail starts with its old due date; a planned part is added only when the block starts today)

- [ ] **Step 1: Write the failing tests** (same file; `const NOW = new Date(2026, 9, 28, 18, 0)`; helper `task(over)` giving an open, medium, undated task with no block):

```ts
test("open tasks due today and overdue ones are listed; the rest are not", () => {
  const plan = planCarryOver([
    task({ id: "today-9", dueDate: at(9, 0) }),
    task({ id: "today-late", dueDate: new Date(2026, 9, 28, 23, 59) }),
    task({ id: "yesterday", dueDate: new Date(2026, 9, 27, 23, 59) }),
    task({ id: "tomorrow", dueDate: at(0, 0, 1) }),
    task({ id: "undated" }),
    task({ id: "done", dueDate: at(9, 0), status: "done" }),
  ], NOW);
  assert.deepEqual(plan.dueToday.map((t) => t.id), ["today-9", "today-late"]);
  assert.deepEqual(plan.overdue.map((t) => t.id), ["yesterday"]);
});

test("a block that starts today is reported so it can be cleared; one tomorrow is not", () => {
  const plan = planCarryOver([
    task({ id: "a", dueDate: at(9, 0), scheduledStart: at(14, 0), scheduledEnd: at(15, 0) }),
    task({ id: "b", dueDate: at(9, 0), scheduledStart: at(14, 0, 1), scheduledEnd: at(15, 0, 1) }),
  ], NOW);
  assert.deepEqual([plan.dueToday[0].plannedStart, plan.dueToday[0].plannedEnd], [at(14, 0), at(15, 0)]);
  assert.deepEqual([plan.dueToday[1].plannedStart, plan.dueToday[1].plannedEnd], [null, null]);
});

test("tomorrowDue keeps the time of day; an overdue task lands on tomorrow, not the day after its old date", () => {
  assert.deepEqual(tomorrowDue(new Date(2026, 9, 28, 23, 59, 59, 999), NOW), new Date(2026, 9, 29, 23, 59, 59, 999));
  assert.deepEqual(tomorrowDue(new Date(2026, 9, 26, 9, 30), NOW), new Date(2026, 9, 29, 9, 30));
});

test("tomorrowDue rolls over a month end and does not move at 00:30", () => {
  const lateOct = new Date(2026, 9, 31, 12, 0);
  assert.deepEqual(tomorrowDue(new Date(2026, 9, 31, 23, 59), lateOct), new Date(2026, 10, 1, 23, 59));
  assert.deepEqual(tomorrowDue(new Date(2026, 9, 28, 9, 0), new Date(2026, 9, 28, 0, 30)), new Date(2026, 9, 29, 9, 0));
});

test("the detail line names a planned time that will be cleared and an overdue task's old date", () => {
  const item = { id: "x", title: "t", priority: "high", dueDate: at(9, 0), plannedStart: at(14, 0), plannedEnd: at(15, 0) };
  assert.equal(carryDetail(item, "dueToday"), "planned 14:00–15:00, will be cleared");
  assert.equal(carryDetail({ ...item, plannedStart: null, plannedEnd: null }, "dueToday"), "");
  const old = { ...item, dueDate: new Date(2026, 9, 26, 9, 0), plannedStart: null, plannedEnd: null };
  assert.equal(carryDetail(old, "overdue"), "due Mon 26 Oct");
  assert.equal(carryDetail({ ...old, plannedStart: at(14, 0), plannedEnd: at(15, 0) }, "overdue"), "due Mon 26 Oct, planned 14:00–15:00, will be cleared");
});
```

- [ ] **Step 2: Run to confirm failure** (the new exports do not exist). Same command as Task 1 — Expected: FAIL.
- [ ] **Step 3: Implement** the four functions per the interfaces, reusing `bucketOf` (do not re-derive the day boundaries) and `dateLabel`.
- [ ] **Step 4: Run to confirm pass,** then `pnpm test`. Then mutation-check three rules (the done filter, the "starts today" test for blocks, keeping the time of day in `tomorrowDue`): each must make a test fail; restore the file after each.
- [ ] **Step 5: Commit** ("Add the carry-over rules: which tasks are unfinished and where they go").

---

### Task 3: The services and the server actions

**Files:**
- Modify: `src/repositories/note-repository.ts` (add `findDailyNote`), `src/services/task-service.ts` (add `carryTaskTo`), `src/services/dashboard-service.ts` (add `todayNote`)
- Create: `src/services/daily-service.ts`, `src/actions/daily.ts`
- Test: `tests/integration/daily.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2; `listEventsInRange` and `listScheduledInRange`/`listTasks` from the event and task repositories; `noteService.createNote`; `AppError`.
- Produces:
  - `findDailyNote(userId: string, title: string): Promise<Note | null>` in the note repository: non-deleted, `tags` has `DAILY_TAG`, exact `title`, `orderBy: { createdAt: "asc" }`, scoped by `userId`.
  - `carryTaskTo(userId: string, taskId: string, dueDate: Date, clearBlock: boolean): Promise<Task>` in the task service: reads the row (scoped by `userId`), then `updateTask` with every other field carried forward (the way `scheduleTask` does), `dueDate` replaced, and `scheduledStart`/`scheduledEnd` set to `null` when `clearBlock`.
  - `daily-service.ts`: `findTodayNote(userId, now?): Promise<{ id: string; updatedAt: Date } | null>`; `openTodayNote(userId, now?): Promise<{ id: string; created: boolean }>` (finds, else gathers today's events, non-done planned blocks and tasks in the `today` bucket, builds the Markdown, creates the note with `tags: [DAILY_TAG]` through `noteService.createNote`); `proposeShutdown(userId, now?): Promise<CarryOverPlan & { tomorrow: Date }>`; `applyShutdown(userId, now: Date, taskIds: string[]): Promise<{ moved: number }>` (re-derives with `proposeShutdown`, moves the requested ids that are in the plan using `tomorrowDue` and `clearBlock` = the item's `plannedStart !== null`; throws `AppError("VALIDATION_ERROR", "Those tasks have already moved or are done. Review the list again.")` when none apply).
  - `Dashboard` gains `todayNote: { id: string; updatedAt: Date } | null`, fetched in `getDashboard`'s existing `Promise.all`.
  - `src/actions/daily.ts` (`"use server"`): `openTodayNoteAction(): Promise<ApiResponse<{ id: string }>>`; `type ShutdownTaskView = { id: string; title: string; priority: string; detail: string }`; `type ShutdownView = { tomorrowLabel: string; dueToday: ShutdownTaskView[]; overdue: ShutdownTaskView[] }`; `proposeShutdownAction(): Promise<ApiResponse<ShutdownView>>` (detail from `carryDetail`, label from `dateLabel`); `applyShutdownAction(taskIds: string[]): Promise<ApiResponse<{ moved: number; tomorrowLabel: string }>>` (Zod: `z.array(z.uuid()).min(1).max(100)`; `revalidatePath` for `/`, `/tasks`, `/calendar`, `/notes`). Each follows `requireUserId()`, parse, service, `toApiResponse`, like `actions/plan.ts`.

- [ ] **Step 1: Write the failing integration tests** in `tests/integration/daily.test.ts` (same header and `before`/`after` as `isolation.test.ts`: `import "dotenv/config"`, two throwaway users A and B created with `prisma.user.create`, removed in `after`; `const NOW = new Date(2026, 9, 28, 18, 0)`; tasks and events created directly with `prisma.task.create` and `prisma.event.create`):
  1. *opening today's note twice gives one note*: A has an event today and a task due today; `openTodayNote(A, NOW)` returns `created: true`; the note's `title` is `2026-10-28`, `tags` is `["daily"]`, and its content includes the event's title, the task's title and `## Notes`; a second call returns the same id with `created: false`; `prisma.note.count` for A with that title is 1.
  2. *another account never shares it*: `openTodayNote(B, NOW)` returns a different id; B's note content contains none of A's titles; `findTodayNote(B, NOW)` is B's own.
  3. *a deleted daily note is not found, and a plain note with the date but no tag does not count*: soft-delete A's daily note (`deletedAt`), `findTodayNote` is null and `openTodayNote` creates a new one; a note titled `2026-10-28` without the tag does not stop A from getting a daily note.
  4. *the proposal holds only the caller's open, dated tasks*: A has one due today, one overdue, one done, one undated, one due tomorrow; B has one due today. `proposeShutdown(A, NOW)` lists exactly A's two; B's is not in it; a task id of B sent to `applyShutdown(A, ...)` alone throws `VALIDATION_ERROR` and B's task is unchanged.
  5. *apply moves due dates to tomorrow and clears today's block only*: A's task due 09:30 today with a block today and A's overdue task (due Mon 26 Oct 09:30) with a block tomorrow: after `applyShutdown(A, NOW, [both])`, the first is due `2026-10-29 09:30` with `scheduledStart` null, the second is due `2026-10-29 09:30` and its block is untouched; titles, priorities and tags are unchanged; `moved` is 2.
  6. *the overdue task is left alone unless it is requested*: `applyShutdown(A, NOW, [dueTodayId])` leaves the overdue task's `dueDate` as it was.
  7. *shutting down twice moves nothing the second time*: a second `applyShutdown` with the same ids rejects with `VALIDATION_ERROR` and the due dates are still tomorrow's.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm test:integration` (needs the database) — Expected: the new file FAILS (cannot find `@/services/daily-service`); the existing integration tests still pass.
- [ ] **Step 3: Implement** the repository function, `carryTaskTo`, `daily-service.ts` and the dashboard addition, then `src/actions/daily.ts`.
- [ ] **Step 4: Run to confirm pass.** `nice -n 19 pnpm test:integration` — Expected: all pass (the existing 17 plus the new ones). Then `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`.
- [ ] **Step 5: Commit** ("Add the daily note and carry-over services and actions").

---

### Task 4: The two cards on Today

**Files:**
- Create: `src/components/today-note.tsx`, `src/components/shut-down-day.tsx`
- Modify: `src/app/(dashboard)/page.tsx`
- Test: `tests/e2e/daily.spec.ts` (new)

**Interfaces:**
- Consumes: `openTodayNoteAction`, `proposeShutdownAction`, `applyShutdownAction`, `ShutdownView` (Task 3); `Dashboard.todayNote`; the `Icon` set (`notes`, `moon` exist).
- Produces:
  - `TodayNote(props: { existing: { id: string; editedLabel: string } | null; dayLabel: string })` (`"use client"`): renders the card's inside, `<h2 id="today-note-title">Today's note</h2>` and either the one-line text `Starts a note for {dayLabel} with your schedule and open tasks.` with a secondary button `Open today's note` (calls `openTodayNoteAction`, then `router.push(`/notes/${id}`)`; shows the error in a `role="alert"`), or a link to `/notes/{id}` whose text is the note's title with `Edited {editedLabel}` under it. The page wraps it in `<section aria-labelledby="today-note-title" className={`${CARD} px-5 py-4`}>` as the first card of the right column.
  - `ShutDownDay()` (`"use client"`): a section styled like `PlanDay` titled `Shut down day` with the text `Moves unfinished tasks to tomorrow. Nothing moves until you confirm.` and a secondary button `Review unfinished tasks` (`aria-expanded`). It calls `proposeShutdownAction`; the panel then shows `Move unfinished tasks to tomorrow?`, `They move to {tomorrowLabel}. Done tasks stay, events are untouched, and a planned time today is cleared.`, a `Due today` group (rows ticked) and an `Overdue from earlier` group (rows unticked, with the line `These stay where they are unless you tick them.`), each row a `<label>` with a checkbox, the title and `{priority word} · {detail}`; buttons `Move {n} task(s) to {tomorrowLabel}` (accent; `Nothing selected` disabled at 0) and `Cancel`. An empty proposal shows `Nothing left to carry over.` After applying: `role="status"` `Moved {n} task(s) to {tomorrowLabel}. Open Today tomorrow and use Plan my day to place them.` and `router.refresh()`. It sits directly under `PlanDay` in the Today's plan card.

- [ ] **Step 1: Write the failing e2e tests** (`tests/e2e/daily.spec.ts`; copy the small `main(page)` helper; create tasks through the Tasks page form as `workspace.spec.ts` does, with `input[name="dueDate"]`; compute the expected ISO title and the tomorrow label in the test from `new Date()`):
  1. *today's note is made once, opens, and is found again*: with a task due today, `goto("/")`, click `Open today's note`; the URL becomes a note page whose `h1` is today's ISO date and whose reading view has headings `Schedule`, `Open tasks` and `Notes` and the task's title with `due today`. `goto("/")` again: no `Open today's note` button, a link with the ISO date; clicking it returns to the same URL. `goto("/notes")` lists that title once.
  2. *shut down moves what is ticked, and overdue is opt-in*: tasks A and B due today, C overdue. `Review unfinished tasks`: A and B are ticked, C is not; the button reads `Move 2 tasks to {tomorrow}`; tick C: `Move 3 tasks…`; untick B: `Move 2 tasks…`; untick everything: `Nothing selected` is disabled; tick A only and press `Move 1 task to {tomorrow}`; the status says `Moved 1 task to {tomorrow}`; the Due today list no longer holds A but still holds B; C is still overdue.
  3. *Cancel closes the panel and changes nothing*: open the panel, press `Cancel`: the panel is gone and the tasks are where they were.
  4. *on a phone the panel fits and is easy to use*: 375px wide, open the panel: no horizontal overflow; each checkbox row and the Move and Cancel buttons have `boundingBox().height >= 44`.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec playwright test tests/e2e/daily.spec.ts --timeout=20000` — Expected: the tests FAIL (no card, no button); the rest of the suite is untouched.
- [ ] **Step 3: Implement `TodayNote` and `ShutDownDay`** with Quiet Studio tokens, copying the shape and classes of `plan-day.tsx` (a transition for the pending state, `role="status"` and `role="alert"` messages).
- [ ] **Step 4: Wire the page.** Destructure `todayNote` from `getDashboard`; render `ShutDownDay` after `PlanDay`; render the `TodayNote` section first in the right-hand column, passing `existing` (`{ id, editedLabel: TIME.format(updatedAt) }` or null) and `dayLabel` from `dateLabel(now)`.
- [ ] **Step 5: Run to confirm pass.** Step 2's command — Expected: pass. Then `nice -n 19 pnpm test:e2e` — Expected: every test passes, including the dashboard and task tests (this file runs first, on the fresh account, so also check that the later files still pass).
- [ ] **Step 6: Commit** ("Add Today's note and Shut down day to the Today page").

---

### Task 5: Guard, check, record, ship

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1: Guard.** Run the `security-review` skill over the diff. What to check: every query is scoped by the session's `userId`; client-sent ids only select from the server's own re-derived list; the note content comes from the person's own data and goes through the existing note validation; no new input reaches a query unvalidated (`z.uuid()` array, capped). Ledger what it found.
- [ ] **Step 2: Simplify.** Run the `simplify` skill over `git diff <BASE>..HEAD -- src tests`; apply behaviour-preserving cleanups only.
- [ ] **Step 3: Check.** `nice -n 19` for each: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Then look at Today on a throwaway account (named with the `e2e` prefix, deleted afterwards): desktop and 375px, light and dark: the two cards, the panel with some tasks, the result line, and the opened daily note.
- [ ] **Step 4: Review.** Read `code-reviewer.md` and review the whole branch yourself (no subagent tool); ledger `Final review: self-review (no subagent tool)`; Critical and Important findings get a failing test first; Minor go to the ledger.
- [ ] **Step 5: Record.** `CLAUDE.md`: a "Daily note and Shut down day" section: the council's decision and why (convention not column, what each option cost, the duplicate-on-rename and restore cases accepted, the escape hatch of a later nullable `dailyDate` with a backfill); the snapshot rule; what "unfinished" means and why overdue is opt-in; what moving does and does not do; propose, confirm, re-derive; the `bucketOf` move; that the cards are absent on an empty workspace; and what was not done: undo, carrying a block for an undated task, weekly or other-day shutdowns, auto-creating the note, `g` shortcuts for them. `README.md`: add a bullet. `ROADMAP.md`: tick item 4. Anchor the new `CLAUDE.md` section at a heading no other open branch edits, to avoid a merge conflict.
- [ ] **Step 6: Ship.** Commit, push `daily-note`, open a pull request against `main` (never a push to `main`) whose description lists what was verified and what was only read; report the checks once; do not poll CI.
