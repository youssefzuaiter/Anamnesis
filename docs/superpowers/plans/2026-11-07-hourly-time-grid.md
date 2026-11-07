# Hourly Week and Day Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The calendar's Week and Day views become an hourly grid: events and task blocks drawn by time, a block moves by drag and resizes by dragging either edge, a task dropped from the tray lands where it is let go, and every move has a button path for touch and keyboard.

**Architecture:** Pure rules in `lib/time-grid.ts` (what is drawn where, the one arithmetic for move, resize, nudge and drop); two small server functions (`rescheduleEvent`, `setTaskBlock`) and three client-callable actions that reuse the existing update and index paths; one client component `time-grid.tsx` using Pointer Events and `useOptimistic`, in the shape of the project board; the calendar page renders it for Week and Day. Month is unchanged. No migration, no new dependency.

**Tech Stack:** Next.js 16 / React 19 (Pointer Events, `useOptimistic`), Prisma 7 (no schema change), Tailwind with the Quiet Studio tokens.

**Spec:** `ROADMAP.md` item 16 ("Hourly week and day grid (L, demo). Drag to move, drag the edge to resize a time block. ... dropping a task still lands at 09:00 today.") and the approved design canvas, https://claude.ai/artifact/WiUFENJoe6SqMntCQkmyZK (week light and dark, a day view mid-interaction, the phone day view light and dark). The user's answer: "yes, build it as drawn", which settles the three open choices: **both edges resize, touch uses buttons only, no undo toast.**

## Decisions

1. **The grid is 00:00 to 24:00, 56px an hour, opens scrolled to 07:00, and snaps to 15 minutes.** Week is seven columns, Day is one. Month is untouched and its cells still land a dropped task at 09:00.
2. **Three kinds of item, told apart by fill, edge and a word, not by colour alone:** an event (solid, accent edge), a task block (dashed), an imported timetable event (grey with a lock). A "now" line is drawn in today's column. Overlapping items sit side by side (lanes within a cluster of overlaps).
3. **Only an item that starts and ends on one local day is a grid item** (ending at exactly midnight counts). Anything else goes to an **All day** strip above the grid and is edited on its own page.
4. **Imported events are read-only, in the grid and on the server.** The calendar-feed sync updates a row by its feed uid, so a moved imported event would be silently put back at the next sync. The server refuses it with a message that says where to change it.
5. **Moving and resizing by Pointer Events, for mouse and pen only.** A press that moves less than 4px is a click (it selects); Escape cancels a drag; a live time label shows while dragging. A touch is never a drag: it scrolls and taps, and the **selection bar** is the touch and keyboard path: Earlier, Later, Shorter, Longer (15 minutes), Previous day, Next day, Edit details. The bar is a normal row of buttons above the grid, `aria-disabled` while a save is in flight and for an imported item (with the reason in its status line).
6. **A move writes the existing fields** through the existing paths: an event's `startTime` and `endTime` (re-indexed); a task block's `scheduledStart` and `scheduledEnd` (the due date is a different thing and is untouched; "Time blocks are separate from due dates"). Moving one occurrence of a series changes only that occurrence. One shared range check on the server: both ends valid dates between 2000 and 2100, end after start, at most 24 hours (the grid never makes more).
7. **Optimistic, one change at a time, with the truth from the server**, as on the board: the block moves at once, goes back with a message if the server refuses, and a refusal because the item is gone refreshes the page. The optimistic arithmetic is the same function the server's rule is tested against.
8. **A task dragged from the tray lands where it is dropped**: the start is the pointer's time snapped to 15 minutes, the length is the task's estimate by the existing rule (`scheduleTask` with no end). A dashed preview shows "Drops at 13:30" while hovering. In Week and Day the tray sits beside the grid from `lg` and below it under `lg`; in Month it stays where it is.
9. **Not built (not drawn):** an undo toast, click or drag on empty space to create an event, a touch drag, dragging a multi-day item, hand-set hours or zoom.

## Global Constraints

- Free self-hosted stack; **no new dependency, no migration**.
- Every query scoped by the session's `userId`; every client-supplied id ownership-checked in the query that uses it; foreign, missing and (for tasks) trashed give the same `RESOURCE_NOT_FOUND`.
- Numbers from the browser are untrusted: integers in a bounded range, validated before any query.
- Quiet Studio tokens only; light and dark designed together; 44px targets on a phone.
- Buttons that are unavailable are `aria-disabled`, never `disabled` (a focused button that becomes disabled loses the keyboard's place).
- React 19 lint: no `setState` in an effect body. Local time everywhere; a day is a calendar day, not 24 hours (daylight saving).
- Browser tests select by label and by `main`; one shared account per run; targeted specs only ("CI runs the rest").
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An imported event, another account's item, a trashed task or a missing id** is refused alike and nothing changes (integration, Task 2).
2. **Numbers that are not a sane time**: NaN, a year 3000, an end before the start, a 30-hour range, a fraction: clamped in the browser and refused by the server (unit and integration).
3. **A press that does not move, a drag cancelled with Escape, and a touch** send nothing and change nothing (Task 4).
4. **A save that fails** puts the block back with a message; the refreshed page does not flash it back; a second change while one is in flight is ignored (Task 3 and 4).
5. **A daylight-saving day, overlapping items and an item that spans days**: positions follow the wall clock, overlaps sit side by side, spans go to the strip (unit, Task 1).
6. **A moved task block keeps every other field of its task**, including its due date (integration, Task 2).

---

### Task 1: The grid's rules

**Files:**
- Create: `src/lib/time-grid.ts`, `tests/unit/time-grid.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (exact):
  - constants `SLOT_MINUTES = 15`, `MIN_BLOCK_MINUTES = 15`, `MINUTES_PER_DAY = 1440`, `HOUR_PX = 56`, `OPEN_AT_MINUTES = 420`.
  - `export type Range = { start: number; end: number }` (epoch milliseconds).
  - `export type GridItem = { key: string; kind: "event" | "block"; id: string; title: string; start: number; end: number; done: boolean; recurring: boolean; locked: boolean; location: string | null }`.
  - `export type StripItem = GridItem & { from: number; to: number }` (0-based columns, inclusive).
  - `export type GridDay = { date: number; isToday: boolean; items: GridItem[] }` (`date` is local midnight).
  - `export type CalendarDayLike = { date: Date; isToday: boolean; events: { id: string; title: string; startTime: Date; endTime: Date; location: string | null; recurrenceId: string | null; subscriptionId: string | null }[]; tasks: { id: string; title: string; start: Date; end: Date; done: boolean; recurring: boolean }[] }`.
  - `export function toGrid(days: readonly CalendarDayLike[]): { days: GridDay[]; strip: StripItem[] }`: a same-day item goes to its day, anything else once to the strip with its first and last column; `locked` is `subscriptionId !== null`; items in a day sorted by start then key.
  - `export function sameDay(start: number, end: number): boolean`.
  - `export function layoutDay<T extends { start: number; end: number }>(items: readonly T[]): (T & { lane: number; lanes: number })[]` (greedy lanes; `lanes` is the widest overlap in the item's cluster).
  - `export function minutesIn(day: number, at: number): number` (wall-clock minutes since the day's local midnight, 0 to 1440; the end of an item at the next midnight is 1440).
  - `export function topPx(minutes: number): number` and `export function minutesAtY(px: number): number` (snapped to 15, clamped 0 to 1440).
  - `export function snapMinutes(minutes: number): number`.
  - `export function moveRange(range: Range, minutes: number, days: number): Range` (snapped; shifts by calendar days keeping the wall clock; clamps so the range stays inside its target day; keeps the duration).
  - `export function resizeRange(range: Range, edge: "start" | "end", minutes: number): Range` (snapped; never shorter than 15 minutes; clamped to the day; the other edge fixed).
  - `export type NudgeOp = "earlier" | "later" | "shorter" | "longer" | "previousDay" | "nextDay"` and `export function nudge(range: Range, op: NudgeOp): Range | null` (null when there is no room: at midnight, or a 15-minute block made shorter).
  - `export function dropRange(day: number, minutes: number, estimateMinutes: number): Range` (start snapped; length the estimate clamped to 15 to 1440; the start moves earlier if the end would pass midnight).
  - `export function checkRange(start: number, end: number): string | null` (the server's rule: finite integers, both between 2000-01-01 and 2100-01-01, end after start, at most 24 hours; the message when not).
  - `export function formatRange(range: Range): string` (`"15:30–17:00"`, 24-hour, local).

- [ ] **Step 1: Write the failing tests** (`tests/unit/time-grid.test.ts`), the cases in Review Focus 2 and 5 included: `toGrid` puts a 09:00-10:30 event and a block in their day, a Fri-to-Sat event once in the strip with columns 4 to 5, an event ending exactly at midnight in the grid, an imported event `locked`; `layoutDay` gives two overlapping items lanes 0 and 1 of 2, a third item after both a lane of 1 of 1, and a chain A-B, B-C (A and C not overlapping) the cluster's widest overlap; `topPx` and `minutesAtY` agree; `moveRange` by 37 minutes snaps to 30 and keeps the duration, clamps at 00:00 and at 24:00, moves a day keeping the wall clock; **on 2026-03-29 and 2026-10-25 in Europe/London** a block moved by a day keeps its wall-clock hours; `resizeRange` never goes under 15 minutes, never past midnight, never moves the other edge; `nudge` for all six ops with the edge cases returning null; `dropRange` for a 90-minute estimate at 23:00 moves the start to 22:30; `checkRange` for NaN, a fraction, 1999, 2101, end before start, equal, 24 h and 24 h plus a millisecond; `formatRange`; a 5,000-item day lays out in a few milliseconds.
- [ ] **Step 2: Run to see it fail:** `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/unit/time-grid.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/lib/time-grid.ts`.** Date arithmetic by local components (`new Date(y, m, d, 0, minutes)`), never by adding 24 hours.
- [ ] **Step 4: Run to see it pass.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(calendar): the rules of an hourly grid`.

### Task 2: Moving an event or a block on the server

**Files:**
- Modify: `src/repositories/event-repository.ts` (add `setEventTimes`), `src/services/event-service.ts` (add `rescheduleEvent`), `src/services/task-service.ts` (add `setTaskBlock`), `src/actions/events.ts` (add `moveEventAction`), `src/actions/tasks.ts` (add `moveTaskBlockAction`, `scheduleTaskAtAction`)
- Create: `tests/integration/time-grid.test.ts`

**Interfaces:**
- Consumes: `checkRange` from Task 1.
- Produces (exact):
  - `eventRepository.setEventTimes(userId: string, eventId: string, start: Date, end: Date): Promise<Event | null>`: one `updateMany` whose where is `{ id, userId, subscriptionId: null }`, then the row.
  - `eventService.rescheduleEvent(userId: string, eventId: string, startTime: Date, endTime: Date): Promise<Event>`: the range check, the scoped read (missing or foreign is `RESOURCE_NOT_FOUND` "That event no longer exists."), an imported event refused with `VALIDATION_ERROR` "An imported event can't be moved here. Change it in the calendar it came from.", the write, the re-index.
  - `taskService.setTaskBlock(userId: string, taskId: string, scheduledStart: Date, scheduledEnd: Date): Promise<Task>`: the range check, then `patchTask(userId, taskId, { scheduledStart, scheduledEnd })`.
  - `moveEventAction(eventId: string, startMs: number, endMs: number): Promise<ApiResponse<null>>`, `moveTaskBlockAction(taskId: string, startMs: number, endMs: number): Promise<ApiResponse<null>>`, `scheduleTaskAtAction(taskId: string, startMs: number): Promise<ApiResponse<null>>` (uses the existing `scheduleTask(userId, taskId, start)`): each parses first (`z.uuid()`, `z.number().int()` within 2000 to 2100), then `requireUserId()`, then the service, then the existing revalidation of the calendar, tasks, projects and the dashboard (and `"/calendar/[id]"` as a page).

- [ ] **Step 1: Write the failing integration tests** (`tests/integration/time-grid.test.ts`, each test its own accounts): `rescheduleEvent` changes only the two times and leaves title, description, location, project, recurrence id and the other occurrences of a series as they were; refuses an imported event (a row with a `subscriptionId`) with that message and leaves it byte for byte; foreign, missing: one refusal and the other account's row unchanged; end not after start, 30 hours, year 3000 and a non-finite value refused with `VALIDATION_ERROR` and nothing written; `setTaskBlock` changes only the block (title, priority, tags, description, estimate, due date, project, goal, status and every progress figure unchanged); a trashed, foreign and missing task refused alike; a block on a done task can still move; `scheduleTask` with a start only gives an end of start plus the estimate.
- [ ] **Step 2: Run them.** The new service functions do not exist yet, so the first run fails on the missing functions (the integration file calls them directly). `nice -n 10 pnpm exec tsx --conditions=react-server --test --test-timeout=120000 tests/integration/time-grid.test.ts`.
- [ ] **Step 3: Implement the repository function, the two service functions and the three actions.**
- [ ] **Step 4: `tsc` and the integration file pass.** The actions need a session and cannot run in the node tests: they are covered by Task 3's and 4's browser tests, which are written first.
- [ ] **Step 5: Commit** `feat(calendar): move an event or a block, and schedule a task at a time`.

### Task 3: The grid, the selection bar and the tray drop

**Files:**
- Create: `src/components/time-grid.tsx`, `tests/e2e/time-grid.spec.ts`
- Modify: `src/app/(dashboard)/calendar/page.tsx` (Week and Day render `TimeGrid`; the tray beside it from `lg`), `src/components/calendar-dnd.tsx` (remove `DayAgenda`; `CalendarGrid` loses `tall`)

**Interfaces:**
- Consumes: Task 1's types and functions; Task 2's actions.
- Produces: `export function TimeGrid({ view, days, strip, nowMs }: { view: "week" | "day"; days: GridDay[]; strip: StripItem[]; nowMs: number })` (client). Semantics: a `<section aria-label="Calendar grid">`; hour labels; each item a `<button aria-pressed aria-label="Title, Wed 11 Nov 15:30 to 17:00, time block">`; a `<section aria-label="Selected block">` with a `role="status"` line and the six buttons (named `Move "Title" 15 minutes earlier` and so on) and an "Edit details" link (`/calendar/<id>` or `/tasks/<id>`); a `role="alert"` for a refusal; the grid scrolls to 07:00 when it opens.

- [ ] **Step 1: Write the failing browser tests** (`tests/e2e/time-grid.spec.ts`, no model; events and blocks made through the forms, imported events and bulk data by database inserts): Week shows hour labels and an event in the right column and at the right height (by its text and its position relative to the hour labels); Day shows one column; overlapping events sit side by side; a multi-day event is in the All day strip, once; selecting a block shows its time in the bar and the Edit details link; **each of Earlier, Later, Shorter, Longer, Previous day, Next day changes the time shown and survives a reload**; an imported event is locked (the bar's buttons `aria-disabled`, the reason in the status, nothing changes); a refused move (route aborted) goes back with an alert; a task removed behind the page's back says so and leaves; **dropping a task from the tray with `dragTo` at a position on the grid gives a block at that time** and the Month view still lands one at 09:00; the day view of the exam-prep spec still shows a session's title; Month is unchanged; phone 375px light and dark: no horizontal overflow, every bar button 44px tall, the grid fits.
- [ ] **Step 2: Run to see it fail:** `nice -n 10 pnpm exec playwright test tests/e2e/time-grid.spec.ts --reporter=list --max-failures=1`. Expected: FAIL on the missing grid.
- [ ] **Step 3: Implement `TimeGrid`, wire the page, and remove the dead agenda.** The bar's moves use `nudge` and `useOptimistic`, one at a time (`aria-disabled` while a save is in flight); a failed save and a gone item behave as the board's do; focus returns to the moved block (`data-focus-key`).
- [ ] **Step 4: Run the spec and the neighbouring specs** (`exam-prep.spec.ts`, `workspace.spec.ts -g "task|navigation|phone"`, `board.spec.ts`): all pass.
- [ ] **Step 5: Commit** `feat(calendar): an hourly week and day grid`.

### Task 4: Dragging to move and resize

**Files:**
- Modify: `src/components/time-grid.tsx`, `tests/e2e/time-grid.spec.ts`

**Interfaces:**
- Consumes: Task 1's `moveRange`, `resizeRange`, `minutesAtY`, `formatRange`; Task 2's actions.
- Produces: pointer handling inside `TimeGrid` (no new export): `pointerdown` on a block body or on its top or bottom edge strip (mouse and pen only, primary button, not a locked item) captures the pointer; a movement under 4px is a click; past it a draft range follows the pointer (minutes from the vertical movement, days from the column under the pointer in Week) and the block draws at the draft with its live time label; `pointerup` commits a changed draft through the same optimistic path as the bar; Escape and `pointercancel` drop the draft.

- [ ] **Step 1: Write the failing browser tests** with real mouse events (`page.mouse`): a drag down by two hours moves a block and the time label and the saved time agree (a reload shows it); a drag across to another column in Week moves it to that day; **dragging the bottom edge and the top edge** resize; a block cannot be dragged past midnight or resized under 15 minutes; **a press with no movement selects and sends nothing; Escape during a drag restores the block and sends nothing; a touch pointer does not start a drag** (a synthetic touch-type pointer event); an imported event cannot be dragged and shows no edge handles; a failed save puts the block back with an alert and the refreshed list does not flash it back; while a save is in flight a second drag is ignored; a drag outside the grid ends at the nearest edge.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement the pointer handling.**
- [ ] **Step 4: Run the whole `time-grid.spec.ts` and the neighbours:** all pass.
- [ ] **Step 5: Commit** `feat(calendar): drag to move and resize a block`.
