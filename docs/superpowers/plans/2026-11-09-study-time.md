# Study time per course Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show how much time was recorded per course, as an observation, from the focus (writing) data and the study timer, both opt-in.

**Architecture:** Two kinds of recorded time stay separate and are never summed: *writing* (existing `FocusTelemetry`, gains a nullable `courseId`) and *timer* (new `StudySession`, `courseId` + `seconds` only). Three independent server-enforced switches on `UserProfile` (tracking, include the course, remember timer sessions), all off by default. Pure maths in `lib/study-time.ts`; writes and reads in `services/focus-service.ts` (actions stay thin, so the enforcement is testable without a session); two UI places: a "By course" section on `/focus` and a "Time on this course" card on the course page.

**Tech Stack:** Next.js 16 server actions/components, Prisma 7 + Postgres (hand-written additive migration), `node:test` unit + integration, Playwright.

**Spec:** `ROADMAP.md` item 18, and the approved demo https://claude.ai/artifact/JNFH84a4wGRRCpKqXL8K33 (owner said "yes" on 2026-11-09, after choosing *re-ask* for the existing consent: the existing checkbox keeps its old meaning, the course is a third, nested switch). The demo's copy is binding; the exact strings are below.

## Global Constraints

- Migration is additive only (nullable column, defaulted columns, new table): the previous release must keep working (`CLAUDE.md` "Operations"). Hand-written SQL, not `migrate dev`.
- Every query is scoped by the session `userId`; every client-supplied id (`courseId`, `taskId`) is ownership-checked; a foreign id is never stored and gives no different answer from an absent one (writing: stored as no course; timer: "That task no longer exists.").
- Opt-in is enforced on the server: `recordWritingSession` refuses while tracking is off (`FORBIDDEN`, "Focus tracking is off."); the course is stored only while tracking AND `focusIncludeCourse` are on; `recordTimerSession` refuses while `timerSessionsEnabled` is off (`FORBIDDEN`, "Remembering timer sessions is off.").
- Turning tracking off also turns `focusIncludeCourse` off. Turning the course on while tracking is off is refused (`FORBIDDEN`, "Turn on Record focus sessions first.").
- Sessions under `MIN_SESSION_SECONDS` (30) are dropped, over `MAX_SESSION_SECONDS` (4 h) are refused by validation; same bounds for both kinds.
- Never record what was written, a note title, a task title or a task id in `StudySession`. Only `userId`, `courseId`, `seconds`, `recordedAt`.
- Presentation: observation only. Two measures shown side by side, never added; courses listed by course code (numeric-aware), never ranked; no targets, trends or good/bad colour; "No course" last. Rolling windows (now minus N×24 h), not calendar days, so there is no timezone question.
- A course in the trash or deleted: its sessions fold into "No course" in every total (totals reconcile); restoring the course brings them back. Sessions recorded before this release have no course and stay under "No course".
- Time format: minutes = `Math.round(seconds / 60)`; `0 m`, `40 m`, `2 h`, `4 h 10 m`. Counts: `1 session`, `14 sessions`.
- Exact UI copy (all from the demo):
  - Focus subtitle: `How long your writing and timer sessions run, and which course the time went to.`
  - Tracking: label `Record focus sessions` (also the `aria-label`), text `While writing a note, Anamnesis measures how long you write for and how fast you type. It never records what you write. Off by default, and the server stores nothing while this is off.`
  - Course (nested under tracking): label `Include the course`; text `Also keep which course the note belongs to, so writing time can be shown by course. Never the note’s title or text. Off by default.`; while tracking is off the box is `disabled` and the text is `Available once “Record focus sessions” is on. Then it also keeps which course the note belongs to, so writing time can be shown by course. Never the note’s title or text.`
  - Timer: label `Remember timer sessions` (also the `aria-label`), text `When you run the timer on a task, Anamnesis keeps how long it ran and which course the task belongs to. It never records what you worked on. Off by default, and the server stores nothing while this is off.`
  - `Delete all recorded sessions`; confirm `Delete all recorded writing and timer sessions? This cannot be undone.`
  - Stats row labels: `Writing sessions`, `Minutes written`, `Average WPM`, `Longest session` (all from writing sessions only).
  - By course: heading `By course · last 28 days` / `last 7 days` / `all recorded`; range links `7 days`, `28 days`, `All recorded` (`aria-current="true"` on the active one, nav `aria-label="Time range"`, anchor `id="by-course"`); lead `Time the app recorded while the switches above were on. It leaves out everything you did elsewhere, and says nothing about how well it went. Listed by course code, not ranked.`; totals `In these 28 days: writing 9 h 40 m across 30 sessions, timer 13 h 20 m across 32 sessions. They measure different things, so they are not added together.` (`In these 7 days:` / `Over everything recorded:`; a measure that is not shown is left out of the sentence); row labels `Writing`, `Timer`; no-course row `No course`; empty, all off `Recording is off, so nothing has been collected.`; empty, something on `Nothing recorded yet. Write a note for a minute, or run the timer on a task, and it will appear here.`; hint (tracking on, course off, writing under No course) `Writing sessions are being recorded without their course, so they all appear here. Turn on “Include the course” above to split them from now on. Sessions already recorded stay here.`
  - Recent sessions list: heading `Recent sessions · N`, rows carry a kind word (`Writing`/`Timer`), duration, course code, and for writing `NN wpm · load`.
  - Footnote: `The session label is a rough heuristic over two crude signals — how long you wrote and how fast you typed. It is an observation about the session, not a measure of you, and nothing in Anamnesis acts on it. A timer session is only how long the clock ran.`
  - Timer, not remembered: `Not remembered. This is just a clock. To keep timer time under its course, turn on “Remember timer sessions” on the Focus page.` (`Focus page` links to `/focus`); remembered: `Remembered under CS 301 when it finishes, when you reset it, or when you leave the page. Only how long it ran is kept.` (no course: `Remembered, with no course, when it finishes, …`); after a save the status line is `Done — that's 25 minutes on this task. Saved 25 min under CS 301. Take a break.` (no code: `Saved 25 min.`).
  - Course card: heading `Time on this course`, `Last 28 days`, lines `Writing` / `Timer`, text `Recorded while the switches on the Focus page were on. Anything you studied elsewhere is not included.`, link `Every course, side by side` (`/focus#by-course`); empty `Nothing recorded for this course in the last 28 days.`; the card is not rendered when tracking and timer are both off and this course has no recorded time at all.

## File Structure

- Create `src/lib/study-time.ts` — pure: ranges, formatting, folding, course lines, bars, which measures show, recent merge, timer delta. Tests `tests/unit/study-time.test.ts`.
- Create `prisma/migrations/20261109120000_study_time/migration.sql`; modify `prisma/schema.prisma`.
- Modify `src/lib/export-shape.ts`, `src/services/export-service.ts`, `tests/unit/export-shape.test.ts`, `tests/integration/export.test.ts`.
- Modify `src/repositories/focus-repository.ts`; create `src/services/focus-service.ts`; modify `src/actions/focus.ts`. Tests `tests/integration/study-time.test.ts`.
- Modify `src/components/focus-settings.tsx`, `focus-tracker.tsx`, `study-timer.tsx`; pages `focus/page.tsx`, `courses/[id]/page.tsx`, `tasks/[id]/page.tsx`, `notes/[id]/page.tsx`, `notes/new/page.tsx`; create `src/components/study-by-course.tsx`, `src/components/course-study-card.tsx` (server components).
- Create `tests/e2e/study-time.spec.ts`.
- After review: `CLAUDE.md` section, `README.md`, `ROADMAP.md` tick, memory.

## Review Focus

1. A forged `courseId` or `taskId` that belongs to another account: nothing of it is stored or revealed (Task 3).
2. A stale page after a switch was turned off: nothing stored; the course never stored without both switches; tracking off clears the course switch (Task 3).
3. A course in the trash or deleted: totals still reconcile under "No course", and come back on restore (Task 2 and 4).
4. Timer double counting: finish then reset, pause/resume, preset change mid-run, leaving the page after a save, reset under 30 s (Task 1 `unsavedTimerSeconds`, Task 5 e2e).
5. Garbage and edges: `?range=abc`, `?range=7&range=28`, a session exactly at the window edge, no data, one huge duration, a measure that is off but has history, never `NaN`/`Infinity`/a bar wider than its track (Task 1 and 4).

---

### Task 1: Pure study-time maths

**Files:**
- Create: `src/lib/study-time.ts`
- Test: `tests/unit/study-time.test.ts`

**Interfaces:**
- Produces (exact):
  - `type StudyRange = "7" | "28" | "all"`; `DEFAULT_RANGE: StudyRange = "28"`; `parseRange(raw: unknown): StudyRange` (only the exact strings `"7"`, `"28"`, `"all"`; arrays, numbers, anything else → `"28"`); `rangeStart(range: StudyRange, now: Date): Date | null` (`now − N×86_400_000 ms`, `null` for `"all"`); `rangeHeading(range): string` (`last 28 days` | `last 7 days` | `all recorded`).
  - `formatDuration(seconds: number): string`; `sessionsLabel(count: number): string`; negative/`NaN`/`Infinity` → `0 m`.
  - `type Measure = { seconds: number; sessions: number }`; `type Grouped = { courseId: string | null; seconds: number; sessions: number }`.
  - `foldByCourse(rows: Grouped[], liveCourseIds: ReadonlySet<string>): Map<string | null, Measure>` — a `courseId` not in the live set becomes `null`; same keys merge by summing.
  - `type CourseLine = { courseId: string | null; code: string | null; title: string | null; writing: Measure; timer: Measure }`; `buildCourseLines(courses: { id: string; code: string; title: string }[], writing: Grouped[], timer: Grouped[]): { lines: CourseLine[]; scaleSeconds: number }` — only courses with any time; sorted by `code` then `title` with `localeCompare(undefined, { numeric: true })`; the `null` line last; `scaleSeconds` = the largest single `seconds` over all lines and both measures (0 when none).
  - `barPercent(seconds: number, scaleSeconds: number): number` — 0 when either is ≤ 0 or not finite; otherwise `seconds / scale × 100` rounded to 1 decimal, at least `2` when seconds > 0, at most `100`.
  - `measuresShown(i: { writingOn: boolean; timerOn: boolean; writingSessions: number; timerSessions: number }): { writing: boolean; timer: boolean }` — a measure shows when its switch is on or it has history.
  - `type RecentEntry = { kind: "writing" | "timer"; id: string; at: Date; seconds: number; courseId: string | null; wpm: number | null; load: string | null }`; `mergeRecent(writing: RecentEntry[], timer: RecentEntry[], take: number): RecentEntry[]` — newest first, ties by id, first `take`.
  - `unsavedTimerSeconds(i: { totalSeconds: number; remainingSeconds: number; savedSeconds: number }): number` — `max(0, total − remaining − saved)`, whole seconds, `0` for non-finite input; `remaining` is clamped into `[0, total]` first.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests** (`tests/unit/study-time.test.ts`, `node:test`): `parseRange` accepts `"7"|"28"|"all"` and maps `undefined`, `""`, `"abc"`, `["7","28"]`, `7`, `"07"`, `"ALL"` to `"28"`; `rangeStart("28", new Date("2026-11-09T12:00:00Z"))` equals `2026-10-12T12:00:00Z` and `rangeStart("all", …)` is `null`, across a DST change date it is still exactly `28×24 h` earlier; `formatDuration` gives `0 m`, `40 m`, `60→"1 m"`… concretely `formatDuration(0)==="0 m"`, `(2400)==="40 m"`, `(7200)==="2 h"`, `(15000)==="4 h 10 m"`, `(3570)==="1 h"` (rounds up), `(29)==="0 m"`, `(-5)`, `(NaN)`, `(Infinity)` all `"0 m"`; `sessionsLabel(1)==="1 session"`, `(0)==="0 sessions"`, `(14)==="14 sessions"`; `foldByCourse` folds an unknown id and `null` together and sums; `buildCourseLines` orders `CS 301, ENG 102, MATH 201, PHYS 110, null` from shuffled input, orders `CS 9` before `CS 10` (numeric), omits a course with no time, includes a course with only timer time with `writing {0,0}`, and returns the scale 22 500 for the demo fixture (largest timer value 375 min); `barPercent` returns `0` for scale `0`, `NaN`, negative, `66.7` for 250/375 min, `2` for a tiny non-zero value, `100` when seconds exceed the scale; `measuresShown` truth table (off + no history hides; off + history shows; on shows); `mergeRecent` interleaves by `at` descending, breaks ties by `id`, truncates; `unsavedTimerSeconds` covers a plain run (1500, 0, 0 → 1500), a paused run (1500, 900, 0 → 600), after a save (1500, 0, 1500 → 0), saved partway (1500, 600, 300 → 600), remaining above total (→ 0), negative remaining (clamped), non-finite (→ 0).
- [ ] **Step 2: Run** `pnpm exec tsx --conditions=react-server --test tests/unit/study-time.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the functions above in `src/lib/study-time.ts` (no imports from Prisma/React; reuse nothing from the app besides types).
- [ ] **Step 4: Run** the same command — Expected: all pass. Run `pnpm exec tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(study-time): pure maths for time per course (ROADMAP 18)`.

### Task 2: Schema, migration and export

**Files:**
- Modify: `prisma/schema.prisma`; create `prisma/migrations/20261109120000_study_time/migration.sql`
- Modify: `src/lib/export-shape.ts`, `src/services/export-service.ts`, `tests/unit/export-shape.test.ts`, `tests/integration/export.test.ts`

**Interfaces:**
- Produces: `UserProfile.focusIncludeCourse Boolean @default(false)`, `UserProfile.timerSessionsEnabled Boolean @default(false)`; `FocusTelemetry.courseId String?` (FK `Course`, `onDelete: SetNull`); model `StudySession { id String @id @default(uuid()); userId String; courseId String?; seconds Int; recordedAt DateTime @default(now()) }` with `@@index([userId, recordedAt])`, FK `User` cascade, FK `Course` SetNull; back-relations `Course.focusSessions`, `Course.studySessions`, `User.studySessions`. `EXPORTED_MODELS.StudySession = "studySessions"`; `buildFullExport` returns `studySessions` (ordered by `recordedAt`, like `focusTelemetry`).

- [ ] **Step 1: Write the failing tests.** In `tests/integration/export.test.ts` add: a `StudySession` row and a `FocusTelemetry` row with a `courseId` appear in `buildFullExport` (`studySessions`, `focusTelemetry[0].courseId`); the streamed export keeps every `studySessions` row when a middle row is deleted mid-download (same pattern as the existing `focusTelemetry` case); the profile object carries `focusIncludeCourse` and `timerSessionsEnabled`. In `tests/unit/export-shape.test.ts` the existing completeness guard must list `StudySession`.
- [ ] **Step 2: Run** `pnpm exec tsx --conditions=react-server --test tests/integration/export.test.ts tests/unit/export-shape.test.ts` — Expected: FAIL (no model).
- [ ] **Step 3: Edit the schema and write the migration by hand** (`ALTER TABLE "UserProfile" ADD COLUMN … DEFAULT false`, `ALTER TABLE "FocusTelemetry" ADD COLUMN "courseId" TEXT`, `CREATE TABLE "StudySession"`, index, three foreign keys), apply with `pnpm exec prisma migrate deploy`, then `pnpm exec prisma generate`. Add the export entries; the `studySessions` table uses `tableBy` ordered by `recordedAt` then `id` exactly like `focusTelemetry`.
- [ ] **Step 4: Run** the Step 2 command and `pnpm exec tsc --noEmit` — Expected: pass.
- [ ] **Step 5: Commit** `feat(study-time): additive migration and export coverage (ROADMAP 18)`.

### Task 3: Recording and the switches, enforced on the server

**Files:**
- Modify: `src/repositories/focus-repository.ts`, `src/actions/focus.ts`; create `src/services/focus-service.ts`
- Test: `tests/integration/study-time.test.ts` (created here)

**Interfaces:**
- Consumes: Task 1 lib; Task 2 schema.
- Produces (exact):
  - repository: `type FocusSwitches = { tracking: boolean; includeCourse: boolean; timer: boolean }`; `getSettings(userId): Promise<FocusSwitches>` (all `false` with no profile row); `setFlags(userId, patch: { focusTrackingEnabled?: boolean; focusIncludeCourse?: boolean; timerSessionsEnabled?: boolean }): Promise<void>` (upsert); `recordSession(userId, { sessionDuration, typingSpeedWpm, cognitiveLoad, courseId: string | null })`; `recordTimerSession(userId, { seconds, courseId: string | null })`; `ownsCourse(userId, courseId): Promise<boolean>`; `findTimedTask(userId, taskId): Promise<{ courseId: string | null; courseCode: string | null } | null>` (task not deleted, scoped by user; `courseCode` null when the course is in the trash); `deleteAllSessions(userId): Promise<number>` (both tables, one transaction, sum of counts); `hasAnySessions(userId): Promise<boolean>`. `isTrackingEnabled` stays.
  - service: `getSettings`, `setTracking(userId, enabled)`, `setIncludeCourse(userId, enabled)`, `setTimerSessions(userId, enabled)` (each returns the new `FocusSwitches`), `recordWritingSession(userId, { activeSeconds, charactersTyped, typingSpeedWpm, courseId?: string | null }): Promise<void>`, `recordTimerSession(userId, { taskId, seconds }): Promise<{ saved: boolean; seconds: number; courseCode: string | null }>`, `clearHistory(userId): Promise<number>`. Failures are `AppError` with the codes in Global Constraints.
  - actions: `recordFocusSessionAction(raw)` (schema gains optional `courseId: z.string().uuid().nullish()`), `setFocusCourseAction(enabled)`, `setTimerSessionsAction(enabled)`, `recordTimerSessionAction(raw)` (`{ taskId: uuid, seconds: int 0..MAX_SESSION_SECONDS }`), existing `setFocusTrackingAction`, `clearFocusHistoryAction`; same `ApiResponse` shapes; each calls `revalidatePath("/focus")`.

- [ ] **Step 1: Write the failing tests** (`tests/integration/study-time.test.ts`, one user per test, cleanup in `after`): writing session stored with the note's course only when tracking and course are on (three cases: tracking off → `FORBIDDEN` and zero rows; tracking on/course off → stored with `courseId null` even when a valid own `courseId` is passed; both on → stored with the id); a foreign account's `courseId` and a random uuid are stored as `null` and the call succeeds identically; sessions under 30 s and zero characters store nothing; `setIncludeCourse(true)` with tracking off throws `FORBIDDEN` "Turn on Record focus sessions first." and changes nothing; `setTracking(false)` also clears `focusIncludeCourse`; `setTimerSessions` toggles independently; `recordTimerSession` with the switch off throws `FORBIDDEN` and stores nothing; with it on stores `seconds` and the task's `courseId`, returns the course code; for a task of another account, a trashed task and a random uuid it throws `RESOURCE_NOT_FOUND` "That task no longer exists." with identical messages and stores nothing; a task whose course is in the trash stores the id but returns `courseCode: null`; under 30 s returns `{ saved: false }` and stores nothing; a `StudySession` row has no column that could hold a title (assert the column list from `information_schema` equals `id,userId,courseId,seconds,recordedAt`); `clearHistory` deletes both tables for that user only and returns the sum, a second user's rows untouched.
- [ ] **Step 2: Run** `pnpm exec tsx --conditions=react-server --test tests/integration/study-time.test.ts` — Expected: FAIL (service missing).
- [ ] **Step 3: Implement** repository functions, `focus-service.ts` (the enforcement lives here, the actions only parse, call `requireUserId`, delegate and `toApiResponse`), and the actions. The effective rule for the course: `settings.tracking && settings.includeCourse && (await ownsCourse(...))`.
- [ ] **Step 4: Run** the Step 2 command and `pnpm exec tsc --noEmit` — Expected: pass.
- [ ] **Step 5: Commit** `feat(study-time): record writing and timer sessions behind three switches (ROADMAP 18)`.

### Task 4: Reading time per course

**Files:**
- Modify: `src/repositories/focus-repository.ts`, `src/services/focus-service.ts`
- Test: `tests/integration/study-time.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `listCourseOptions(userId)` from the course repository.
- Produces: repository `groupWritingByCourse(userId, filter: { since: Date | null; courseId?: string })` and `groupTimerByCourse(...)` → `Grouped[]` (database `groupBy`, scoped by `userId`, `recordedAt >= since`), `listRecentWriting(userId, take)`, `listRecentTimer(userId, take)` → `RecentEntry[]`. Service `getStudyTime(userId, range: StudyRange, now: Date): Promise<StudyTimeView>` with `StudyTimeView = { settings: FocusSwitches; range: StudyRange; lines: CourseLine[]; scaleSeconds: number; writing: Measure; timer: Measure; shown: { writing: boolean; timer: boolean }; recent: RecentEntry[]; courses: { id: string; code: string; title: string }[]; stats: FocusSummary; hasHistory: boolean; courseHint: boolean }` and `getCourseStudyTime(userId, courseId, now): Promise<{ settings: FocusSwitches; writing: Measure; timer: Measure; shown: { writing: boolean; timer: boolean }; visible: boolean }>` (28-day window; `visible` per Global Constraints).

- [ ] **Step 1: Write the failing tests:** `getStudyTime` with sessions for two live courses, a trashed course and no course returns lines by course code with the trashed course's time under the `null` line and `writing.seconds`/`timer.seconds` equal to the table sums; restoring the course (clearing `deletedAt`) moves its time back; a session exactly `28×24 h` before `now` is included and one millisecond older is excluded; `"all"` includes everything; a second account's rows never appear; `courseHint` is true only when tracking is on, the course switch is off and the `null` line has writing time; an account with nothing returns empty lines, `scaleSeconds 0` and no `NaN` anywhere; `getCourseStudyTime` returns only that course's sums, a foreign course id returns zeros and `visible` false when both switches are off; `visible` is true with a switch on, or with history for the course while both are off; `recent` holds writing and timer entries merged newest first, at most 30, with `wpm`/`load` null for timer entries.
- [ ] **Step 2: Run** the integration file — Expected: FAIL.
- [ ] **Step 3: Implement** with `Promise.all` for independent queries and the Task 1 helpers (`foldByCourse` via `buildCourseLines`; the live course set from `listCourseOptions`).
- [ ] **Step 4: Run** the integration file, the unit file and `tsc` — Expected: pass.
- [ ] **Step 5: Commit** `feat(study-time): read recorded time per course (ROADMAP 18)`.

### Task 5: Switches, tracker and timer in the browser

**Files:**
- Modify: `src/components/focus-settings.tsx`, `src/components/focus-tracker.tsx`, `src/components/study-timer.tsx`, `src/app/(dashboard)/notes/[id]/page.tsx`, `src/app/(dashboard)/notes/new/page.tsx`, `src/app/(dashboard)/tasks/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 3 actions, Task 1 `unsavedTimerSeconds`, `getSettings`.
- Produces: `FocusSettings({ settings: FocusSwitches; hasHistory: boolean })` (three checkboxes, optimistic like today, the nested one `disabled` while tracking is off, `router.refresh()` after each); `FocusTracker({ selector, includeCourse, courseSelector? })` reads the course `<select>` element once at setup (a detached element keeps its value) and sends `courseId` only when `includeCourse` is true and the value is non-empty; the pages pass `courseSelector='select[name="courseId"]'`; `StudyTimer({ taskId, taskTitle, remember: { enabled: boolean; courseCode: string | null } })` keeps `savedSeconds` in a ref, saves `unsavedTimerSeconds(...)` (when ≥ 30) on finish, on reset (including a preset change) and on `pagehide`/unmount, never on tab switch; the copy is in Global Constraints.

- [ ] **Step 1: Write the failing e2e** `tests/e2e/study-time.spec.ts` for the switches (Task 7 holds the rest): the three labelled checkboxes exist, the course box is disabled until `Record focus sessions` is ticked, ticking tracking then the course persists across a reload, unticking tracking unticks and disables the course box. Run `E2E_PORT=3177 nice -n 19 pnpm exec playwright test tests/e2e/study-time.spec.ts` — Expected: FAIL.
- [ ] **Step 2: Implement** the three components and the page wiring (`notes/new` passes the same selector; the tasks page passes `taskId`, `settings.timer` and the code of the task's course from `listCourseOptions`).
- [ ] **Step 3: Run** the e2e spec, `pnpm exec tsc --noEmit`, `pnpm lint` — Expected: pass.
- [ ] **Step 4: Commit** `feat(study-time): the three switches, the course on a note, the remembered timer (ROADMAP 18)`.

### Task 6: By course and the course card

**Files:**
- Create: `src/components/study-by-course.tsx`, `src/components/course-study-card.tsx`
- Modify: `src/app/(dashboard)/focus/page.tsx`, `src/app/(dashboard)/courses/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 4 views, Task 1 `formatDuration`, `sessionsLabel`, `barPercent`, `rangeHeading`.
- Produces: `StudyByCourse({ view })` (server component; rows are `<li>` with the course link `/courses/<id>`, bars `aria-hidden`, values as text; empty and hint states per Global Constraints) and `CourseStudyCard({ view })`; `/focus` reads `searchParams.range` through `parseRange`; the page order is header, switches, stats, By course, Recent sessions, footnote; the card sits directly under the course summary strip. Design tokens only (Quiet Studio classes); two bar tones: writing `bg-accent`, timer `bg-control`.

- [ ] **Step 1: Write the failing e2e** (append to the spec): seed a course, a writing session and a timer session by SQL for the e2e account, switch both on, open `/focus` and assert the `By course` region lists the course with `Writing` and `Timer` values, `?range=7` and a garbage `?range=abc` render without error, the links carry `aria-current`, and the course page shows `Time on this course` with the same numbers; with both switches off and no rows the card is absent. Run it — Expected: FAIL.
- [ ] **Step 2: Implement** the components and pages.
- [ ] **Step 3: Run** the spec, `tsc`, `pnpm lint` — Expected: pass.
- [ ] **Step 4: Commit** `feat(study-time): By course on Focus and a card on the course page (ROADMAP 18)`.

### Task 7: The writing and timer paths end to end

**Files:**
- Modify: `tests/e2e/study-time.spec.ts`

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Write the tests:** with `page.clock` installed, a note in a course with tracking and course on: type a character, `fastForward` 40 s, type another, leave the page, and the course's writing time appears on its course card (≥ 40 s → `1 m`); the same with the course switch off lands under `No course`; the timer: with the switch on, `fastForward` 26 min finishes a 25 min timer, the status line says `Saved 25 min under <code>`, and pressing `Reset` afterwards adds nothing (one timer session); with the switch off the line says `Not remembered` and nothing is stored (checked by SQL). `afterAll` resets the e2e account's three flags by SQL so other specs are unaffected.
- [ ] **Step 2: Run** the spec with `E2E_PORT=3177 nice -n 19` — Expected: pass; if `page.clock` cannot drive the timer, seed by SQL and record that in the ledger as a ruling.
- [ ] **Step 3: Commit** `test(study-time): writing and timer paths in the browser (ROADMAP 18)`.

### Task 8 (after review): Record

**Files:** `CLAUDE.md` (new section "Study time per course" placed after "Focus telemetry is opt-in…"; fix the sentence that calls `focusTrackingEnabled` the one added column), `README.md`, `ROADMAP.md` (tick 18), memory (`project_nexus.md`).

- [ ] Write the decision log (data premise was false; Option A; three switches and why *re-ask*; separate measures; rolling windows; trash folding; measured facts; limits), tick the roadmap, update the README, then commit `docs: record study time per course (ROADMAP 18)`.
