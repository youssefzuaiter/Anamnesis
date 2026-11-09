# Edit This and Future Occurrences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an event or task that is one occurrence of a repeating series, the edit form can apply what the person changed to this occurrence and every later one, instead of only this one.

**Architecture:** A series stays what it is: real rows sharing a `recurrenceId`, no stored rule, **no migration**. A pure module (`lib/series-edit.ts`) works out what changed between the stored row and the submitted form and applies only that to a later row; two service functions (`updateEventSeriesFrom`, `updateTaskSeriesFrom`) update this row, then each later row through the existing update paths (re-index, progress). The forms get an "Apply changes to" choice and say how many rows changed.

**Tech Stack:** Next.js 16 / React 19 (server actions with `useActionState`), Prisma 7 (no schema change), Tailwind with the Quiet Studio tokens.

**Spec:** `ROADMAP.md` item 17 ("Repeating items: edit this and future (M, migration?). Today a series is materialised rows with a shared `recurrenceId`; keep that model.") and `CLAUDE.md` "Recurrence is materialized once, not a stored rule". Not tagged *demo*, so there is no mock; it is looked at in the browser.

## Decisions (made inline; the council was mine, not independent subagents)

1. **No migration.** A series is found by `recurrenceId`; "later" is the rows whose start (events) or due date (tasks) is at or after this one's, this row excluded: the rule `deleteEventSeriesFrom` and `deleteTaskSeriesFrom` already use. Nothing about a rule is stored, so nothing needs a column. (Storing a rule to re-expand a series would; that is not built.)
2. **Only what changed is copied.** The server compares the stored row with the submitted form and copies the fields that differ. A later occurrence someone edited on its own (a different room) keeps that value when the person only changed the title. The browser sends the form and a scope, never a list of rows or what changed.
3. **What is copied.** Events: title, description, location, project, **time of day** (the new start's minutes after local midnight, put on each row's own date) and **length**. Tasks: title, description, priority, tags, estimate, project, course, goal. **Dates are never copied** (an event's day, a task's due date), nor a task's time block, status or checklist: each occurrence keeps its own. Fork considered: also shift later dates by the same number of days, which would let a series move to another weekday. Rejected for now: it needs rules for monthly clamping, daylight saving and a task's block that are not worth it, and the workaround exists (delete this and later, make a new series). The form says dates stay.
4. **Scope.** "This and later" is by date, like Delete this and future occurrences: earlier occurrences are history and are never touched. A trashed task, an imported event and another account's row that shares the id are never touched. A later task that is already done is changed and stays done. An occurrence with no later ones, a one-off, or a series task with no due date (nothing to order by) is saved as only this.
5. **The result is said, from the server.** The actions return `{ changed, scope }`: `changed` is the number of rows actually modified, this one included. The form says "Saved.", or how many later occurrences got the change, or that none needed it (and that dates are not copied), so a date-only edit with "this and later" is not a silent no-op.
6. **Not atomic.** This row first, then the later rows one after another through the existing update paths; a failure part-way leaves the earlier ones changed and says so. Series are capped at 52 rows, as delete's loop is.
7. **Not built:** changing the repeat pattern or count, shifting a series to another day, copying a task's block, a series-wide undo, offering it from the calendar grid (a drag still moves one occurrence).

## Global Constraints

- Free self-hosted stack; **no new dependency, no migration**.
- Every query scoped by the session's `userId`; the browser sends the occurrence id, the form and `applyTo` (`this` or `future`, anything else is `this`), nothing else.
- Local time everywhere; a day is a calendar day (daylight saving).
- Unavailable controls are `aria-disabled`, never `disabled` (the existing submit's `disabled={pending}` is untouched); 44px targets on a phone; Quiet Studio tokens only; light and dark designed together.
- React 19 lint: no `setState` in an effect body.

## Review Focus

1. **Rows that must never change:** another account's row sharing the `recurrenceId`, a trashed task occurrence, an imported event sharing it, and every earlier occurrence (integration, Task 2).
2. **An occurrence edited on its own keeps its value** for a field the person did not change (integration and browser).
3. **Time of day across a clock change:** each row keeps its own date and gets the new wall-clock time, on 29 March and 25 October in Europe/London (unit, Task 1).
4. **Bad input writes nothing, to this row or a later one:** an end before the start, another account's project, course or goal (integration, Task 2).
5. **A scope that finds nothing to copy** (last occurrence, a one-off, a series task with no due date, a date-only change) saves this row and says so (integration and browser).

---

### Task 1: The rules

**Files:**
- Create: `src/lib/series-edit.ts`
- Test: `tests/unit/series-edit.test.ts`

**Interfaces:**
- Produces:
  - `export type SeriesScope = "this" | "future"`; `export type SeriesSaved = { changed: number; scope: SeriesScope }`.
  - `export type EventFields = { title: string; description: string | null; location: string | null; projectId: string | null; startTime: Date; endTime: Date }`; `export type EventChange = Partial<Pick<EventFields, "title" | "description" | "location" | "projectId">> & { startMinutes?: number; durationMs?: number }`.
  - `export function diffEvent(before: EventFields, after: EventFields): EventChange`: a field is present only if it differs; `startMinutes` (minutes after local midnight of the new start) only if the time of day differs; `durationMs` only if the length differs. A change of day alone is an empty change.
  - `export function applyEventChange(row: EventFields, change: EventChange): EventFields`: a new object; the row's own date is kept; `startMinutes` sets the wall-clock time on that date; the end is the new start plus `durationMs` if given, else the row's own length.
  - `export type TaskFields = { title: string; description: string | null; priority: string; tags: string[]; estimatedMinutes: number; projectId: string | null; courseId: string | null; goalId: string | null }`; `export type TaskChange = Partial<TaskFields>`.
  - `export function diffTask(before: TaskFields, after: TaskFields): TaskChange` (tags compare element by element, in order); `export function applyTaskChange(row: TaskFields, change: TaskChange): TaskFields`.
  - `export function isEmptyChange(change: object): boolean`; `export function sameEvent(a: EventFields, b: EventFields): boolean`; `export function sameTask(a: TaskFields, b: TaskFields): boolean`.
  - `export function savedMessage(saved: SeriesSaved | null): string`: scope `this` or `null` gives "Saved."; `future` with `changed` 1 gives "Saved. No later occurrence needed changing (dates are not copied)."; otherwise "Saved. The same change was made to N later occurrence(s)." (N = `changed - 1`, singular for 1).

- [ ] **Step 1: Write the failing tests** (`tests/unit/series-edit.test.ts`): `diffEvent` for each field alone, for nothing changed (empty), for a day-only move (empty), for a time-of-day-only move (`startMinutes` only, `durationMs` absent when the length is the same), for a length-only change, and for time and length together; `applyEventChange` keeps a later row's own date and its own length when only the time moves, and sets the length when `durationMs` is given; **on 2026-03-29 and 2026-10-25 in Europe/London** (set `process.env.TZ`, restore it) a row on the clock-change day gets 10:00 on that day; `diffTask` for each field, tags changed by order, and for nothing changed; `applyTaskChange` copies only the changed keys; `sameEvent`/`sameTask`; `savedMessage` for `null`, `this`, `future` with 1, 2 and 3 changed; a 5,000-change application is fast (under 200 ms).
- [ ] **Step 2: Run to see it fail:** `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/unit/series-edit.test.ts`. Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement `lib/series-edit.ts`** (no Prisma, no React; wall-clock arithmetic with `new Date(y, m, d, 0, minutes)`).
- [ ] **Step 4: Run it again.** Expected: PASS; mutation-check each rule (a field dropped from the diff, the day copied, the row's own length ignored, the message wording) and see a test fail each time.
- [ ] **Step 5: Commit** `feat(series): the rules for editing this and later occurrences`.

### Task 2: The server

**Files:**
- Modify: `src/repositories/event-repository.ts`, `src/repositories/task-repository.ts`, `src/services/event-service.ts`, `src/services/task-service.ts`
- Test: `tests/integration/series-edit.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `eventRepository.listLaterSeriesEvents(userId: string, recurrenceId: string, from: Date, exceptId: string): Promise<Event[]>`: this account's rows with that `recurrenceId`, `subscriptionId: null`, `startTime >= from`, not `exceptId`, by start.
  - `taskRepository.listLaterSeriesTasks(userId: string, recurrenceId: string, from: Date, exceptId: string): Promise<Task[]>`: the same with `deletedAt: null` and `dueDate >= from`.
  - `eventService.updateEventSeriesFrom(userId: string, eventId: string, input: EventInput): Promise<{ changed: number }>` and `taskService.updateTaskSeriesFrom(userId: string, taskId: string, input: TaskInput): Promise<{ changed: number }>`: read the row first (scoped; missing or foreign is `RESOURCE_NOT_FOUND`, "That event no longer exists." / "That task no longer exists."), work out the later rows from the row's **old** date, validate the input (the existing range rule and ownership checks) before any write, update this row, then each later row whose result differs, through `updateEvent` / `patchTask`. `changed` counts rows modified, this one included.

- [ ] **Step 1: Write the failing integration tests** (`tests/integration/series-edit.test.ts`, each test its own accounts, series made by `createRecurringEvents` / `createRecurringTasks` or by inserts): events: a title change reaches the later rows and not the earlier ones; a time-of-day change keeps each row's date; a length change; **a later row with its own location keeps it when only the title changed**; a day-only change changes this row and nothing else (`changed` 1); the last occurrence, a one-off and an unsplit `this` behave as only this; **another account's row with the same `recurrenceId`, an imported event with the same `recurrenceId` and every earlier row are byte for byte unchanged**; an end before the start and another account's project write nothing anywhere; `changed` counts only rows that differed. Tasks: the eight fields reach later rows; due dates, blocks, status and checklists are untouched; a later done task changes and stays done; **a trashed later occurrence, another account's row with the same `recurrenceId` and earlier rows are unchanged**; a series task with no due date is saved as only this; another account's course or goal writes nothing; moving the series to another project recalculates both projects' progress and a goal's; a missing or foreign id is `RESOURCE_NOT_FOUND`.
- [ ] **Step 2: Run to see it fail:** `nice -n 10 pnpm exec tsx --conditions=react-server --test --test-timeout=120000 tests/integration/series-edit.test.ts`. Expected: FAIL, the functions do not exist.
- [ ] **Step 3: Implement the two repository functions and the two service functions.**
- [ ] **Step 4: Run it again.** Expected: PASS; mutation-check (the `userId`, `subscriptionId` and `deletedAt` conditions dropped one at a time, the earlier rows included, the old date replaced by the new one, validation moved after the first write) and see a test fail each time.
- [ ] **Step 5: Commit** `feat(series): edit this and later occurrences in the service`.

### Task 3: The actions, the forms and the pages

**Files:**
- Modify: `src/actions/events.ts`, `src/actions/tasks.ts`, `src/components/event-form.tsx`, `src/components/task-form.tsx`, `src/app/(dashboard)/calendar/[id]/page.tsx`, `src/app/(dashboard)/tasks/[id]/page.tsx`
- Test: `tests/e2e/series-edit.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `updateEventAction` / `updateTaskAction` read `applyTo` (Zod enum `this | future`, anything else `this`), call the series function for `future`, and return `ok({ changed, scope })`; the create actions and both forms' action type become `(prevState: ApiResponse<SeriesSaved | null> | null, formData: FormData) => Promise<ApiResponse<SeriesSaved | null>>`. `EventForm` and `TaskForm` take `series?: { later: number }`; with `later > 0` they render `<fieldset>` "Apply changes to" with radios `name="applyTo"`: "Only this occurrence" (default) and "This and N later occurrences", and a line saying what is copied and that dates stay (events: title, description, location, project, time of day and length; tasks: title, description, priority, tags, estimate, project, course and goal; "Due dates, time blocks and done marks stay"). The status line is `savedMessage(state.data)`. The pages pass `later` (the length of the repository's later list) only for a recurring occurrence.

- [ ] **Step 1: Write the failing browser tests** (`tests/e2e/series-edit.spec.ts`, no model; series by the create form once, otherwise inserts; far-future dates; read through `main`): an event series made with Repeat weekly: on the second occurrence a location and a time are changed with "This and 2 later occurrences", the status says "Saved. The same change was made to 2 later occurrences.", the first occurrence is unchanged and the third and fourth have the location and time on their own dates; **the default is only this occurrence** (a change without choosing changes one row); an occurrence edited on its own keeps its location when the title is changed for all; **the last occurrence and a one-off show no choice**; a date-only change with "this and later" says "No later occurrence needed changing (dates are not copied)"; a task series: priority, tags and estimate reach the later rows, due dates and done marks stay, a trashed occurrence is untouched; an end before the start shows the existing alert and changes nothing; phone 375px light and dark: the radios are 44px tall and nothing overflows.
- [ ] **Step 2: Run to see it fail:** `nice -n 10 pnpm exec playwright test tests/e2e/series-edit.spec.ts --reporter=list --max-failures=1`. Expected: FAIL, there is no choice on the page.
- [ ] **Step 3: Implement the actions, the forms and the pages.**
- [ ] **Step 4: Run the spec and the neighbours** (`workspace.spec.ts -g "task|navigation|phone"`, `exam-prep.spec.ts`, `board.spec.ts`, `time-grid.spec.ts`, `calendar-feed.spec.ts`): all pass.
- [ ] **Step 5: Commit** `feat(series): edit this and later occurrences from the event and task pages`.
